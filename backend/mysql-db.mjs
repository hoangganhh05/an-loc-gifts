import mysql from 'mysql2/promise';
import {AsyncLocalStorage} from 'node:async_hooks';
import {products} from './catalog.mjs';

const transactions = new AsyncLocalStorage();
const schema = [
 `CREATE TABLE IF NOT EXISTS users (id VARCHAR(36) PRIMARY KEY,email VARCHAR(320) UNIQUE NOT NULL,name VARCHAR(150) NOT NULL,password TEXT NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'customer')`,
 `CREATE TABLE IF NOT EXISTS sessions (token CHAR(64) PRIMARY KEY,user_id VARCHAR(36) NOT NULL,expires BIGINT NOT NULL,CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
 `CREATE TABLE IF NOT EXISTS products (id VARCHAR(80) PRIMARY KEY,data LONGTEXT NOT NULL,stock INT NOT NULL,reserved INT NOT NULL DEFAULT 0)`,
 `CREATE TABLE IF NOT EXISTS records (id VARCHAR(36) PRIMARY KEY,kind VARCHAR(30) NOT NULL,owner VARCHAR(36) NOT NULL,data LONGTEXT NOT NULL,created VARCHAR(40) NOT NULL,INDEX records_owner (owner,kind),CONSTRAINT records_owner_fk FOREIGN KEY (owner) REFERENCES users(id))`,
 `CREATE TABLE IF NOT EXISTS audit (id VARCHAR(36) PRIMARY KEY,actor VARCHAR(36) NOT NULL,action VARCHAR(500) NOT NULL,created VARCHAR(40) NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS uploads (id VARCHAR(36) PRIMARY KEY,owner VARCHAR(36) NOT NULL,mime VARCHAR(80) NOT NULL,body LONGBLOB NOT NULL,CONSTRAINT uploads_owner_fk FOREIGN KEY (owner) REFERENCES users(id))`,
 `CREATE TABLE IF NOT EXISTS settings (key_name VARCHAR(80) PRIMARY KEY,value TEXT NOT NULL)`
];

export async function openDatabase(options={}) {
 const host=options.host||process.env.MYSQL_HOST||'127.0.0.1';
 const user=options.user||process.env.MYSQL_USER||'root';
 const password=options.password??(process.env.MYSQL_PASSWORD||'');
 const database=options.database||process.env.MYSQL_DATABASE||'an_loc_gifts';
 if(!/^[A-Za-z0-9_]+$/.test(database))throw Error('MYSQL_DATABASE không hợp lệ.');
 const ssl=process.env.MYSQL_SSL==='true'?{rejectUnauthorized:true,...(process.env.MYSQL_SSL_CA?{ca:process.env.MYSQL_SSL_CA.replace(/\\n/g,'\n')}:{})}:undefined;
 const connection={host,port:Number(process.env.MYSQL_PORT||3306),user,password,ssl,connectTimeout:15000};
 if(process.env.MYSQL_CREATE_DATABASE!=='false'){
  const admin=await mysql.createConnection(connection);
  try{await admin.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);}finally{await admin.end();}
 }
 const pool=mysql.createPool({...connection,database,waitForConnections:true,connectionLimit:10});
 const db={kind:'mysql',pool,prepare(sql){
   return {
    async get(...params){const [rows]=await (transactions.getStore()||pool).execute(sql,params);return rows[0];},
    async all(...params){const [rows]=await (transactions.getStore()||pool).execute(sql,params);return rows;},
    async run(...params){const [result]=await (transactions.getStore()||pool).execute(sql,params);return result;}
   };
 },async close(){await pool.end();}};
 for(const statement of schema)await pool.query(statement);
 const seeded=await db.prepare("SELECT 1 FROM settings WHERE key_name='seeded'").get();
 if(!seeded){
  const insert=db.prepare('INSERT IGNORE INTO products (id,data,stock,reserved) VALUES (?,?,?,0)');
  for(const p of products)await insert.run(p.id,JSON.stringify({...p,active:true}),p.stock);
  await db.prepare("INSERT INTO settings (key_name,value) VALUES ('seeded','true')").run();
 }
 return db;
}

export async function transaction(db,fn){
 const current=transactions.getStore();
 if(current)return fn();
 const connection=await db.pool.getConnection();
 try{
  await connection.beginTransaction();
  const result=await transactions.run(connection,fn);
  await connection.commit();
  return result;
 }catch(error){
  await connection.rollback();
  throw error;
 }finally{connection.release();}
}

export async function listProducts(db){
 const rows=await db.prepare('SELECT * FROM products').all();
 return rows.map(r=>({...JSON.parse(r.data),stock:r.stock,reserved:r.reserved}));
}

export async function createOrder(db,owner,d){
 if(d?.adult!==true||!d.name?.trim()||!d.recipient?.trim()||!d.address?.trim()||!/^\+?[\d\s]{9,15}$/.test(d.phone))throw Error('Điền đủ thông tin người mua, người nhận, địa chỉ và xác nhận độ tuổi.');
 if(d.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||d.date<new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date())))throw Error('Ngày giao mong muốn không hợp lệ.');
 if(!Array.isArray(d.items)||!d.items.length||d.items.length>30)throw Error('Giỏ hàng không hợp lệ.');
 return transaction(db,async()=>{
  const all=await listProducts(db),map=new Map(all.map(p=>[p.id,p])),counts={};
  for(const l of d.items){
   if(!Number.isSafeInteger(l.qty)||l.qty<1||l.qty>100000||!Array.isArray(l.parts)||!l.parts.length||l.parts.length>6)throw Error('Số lượng hoặc cấu hình quà không hợp lệ.');
   const wines=l.parts.filter(p=>map.get(p)?.alcohol),boxes=l.parts.filter(p=>map.get(p)?.type==='Hộp');
   if(boxes.length>1||boxes.some(id=>Number(map.get(id).capacity||parseInt(map.get(id).volume))!==wines.length))throw Error('Số chai không phù hợp với hộp quà.');
   for(const p of l.parts)counts[p]=(counts[p]||0)+l.qty;
  }
  for(const [id,q]of Object.entries(counts)){const p=map.get(id);if(!p||!p.active||p.stock-p.reserved<q)throw Error(`Không đủ tồn kho: ${p?.name||id}.`);}
  const items=d.items.map(l=>({qty:l.qty,message:String(l.message||'').slice(0,500),parts:l.parts.map(id=>({id,name:map.get(id).name,price:map.get(id).price})),price:l.parts.reduce((n,id)=>n+map.get(id).price,0)}));
  const subtotal=items.reduce((n,l)=>n+l.price*l.qty,0);if(!Number.isSafeInteger(subtotal))throw Error('Giá trị đơn vượt giới hạn xử lý.');const shipping=subtotal>=3000000?0:40000,id=crypto.randomUUID(),created=new Date().toISOString();
  const data={name:d.name.trim().slice(0,150),recipient:d.recipient.trim().slice(0,150),phone:d.phone,address:d.address.trim().slice(0,600),date:d.date||'',note:String(d.note||'').slice(0,1000),items,counts,subtotal,shipping,total:subtotal+shipping,status:'Chờ xác nhận',payment:'Chưa thanh toán',paymentMode:'sandbox',ageVerification:'Chờ kiểm tra người mua và người nhận',history:[{at:created,status:'Chờ xác nhận'}]};
  for(const [p,q]of Object.entries(counts))await db.prepare('UPDATE products SET reserved=reserved+? WHERE id=?').run(q,p);
  await db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').run(id,'order',owner,JSON.stringify(data),created);
  return {id,data,created};
 });
}

export async function transitionOrder(db,id,status,actor){return transaction(db,async()=>{
 const row=await db.prepare("SELECT * FROM records WHERE id=? AND kind='order'").get(id);if(!row)throw Error('Không tìm thấy đơn.');const d=JSON.parse(row.data),steps=['Chờ xác nhận','Đã xác nhận','Đang chuẩn bị','Đang giao','Hoàn tất'];
 if(status==='Đã hủy'){if(!steps.slice(0,3).includes(d.status))throw Error('Không thể hủy ở trạng thái này.');if(!['Chưa thanh toán','Đã hoàn tiền thử nghiệm'].includes(d.payment))throw Error('Cần hoàn tiền trước khi hủy.');}
 else if(!steps.includes(d.status)||steps.indexOf(status)!==steps.indexOf(d.status)+1)throw Error('Chuyển trạng thái không hợp lệ.');
 if(status==='Đang giao'&&(d.payment!=='Đã thanh toán thử nghiệm'||d.ageVerification!=='Đã kiểm tra quy trình độ tuổi'))throw Error('Cần xác nhận thanh toán và kiểm tra độ tuổi trước khi giao.');
 if(['Đang giao','Đã hủy'].includes(status))for(const[p,q]of Object.entries(d.counts))await db.prepare(status==='Đang giao'?'UPDATE products SET reserved=reserved-?,stock=stock-? WHERE id=?':'UPDATE products SET reserved=reserved-? WHERE id=?').run(...(status==='Đang giao'?[q,q,p]:[q,p]));
 d.status=status;d.history.push({at:new Date().toISOString(),status,actor});await db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(d),id);return d;
});}
