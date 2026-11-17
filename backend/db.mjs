import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {products} from './catalog.mjs';
export function openDatabase(path='data/shop.sqlite'){
 if(path!==':memory:')mkdirSync('data',{recursive:true});
 const db=new DatabaseSync(path);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('admin','sales','warehouse','customer')));
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,data TEXT NOT NULL,stock INTEGER NOT NULL CHECK(stock>=0),reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=stock));
 CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner TEXT NOT NULL REFERENCES users(id),data TEXT NOT NULL,created TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS records_owner ON records(owner,kind);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),mime TEXT NOT NULL,body BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 if(!db.prepare("SELECT 1 FROM settings WHERE key='seeded'").get()){
  const insert=db.prepare('INSERT OR IGNORE INTO products VALUES (?,?,?,0)');for(const p of products)insert.run(p.id,JSON.stringify({...p,active:true}),p.stock);
  db.prepare("INSERT INTO settings VALUES ('seeded','true')").run();
 }
 return db;
}
const activeTransactions=new WeakSet();
export function transaction(db,fn){
 if(activeTransactions.has(db))return fn();
 db.exec('BEGIN IMMEDIATE');activeTransactions.add(db);
 try{
  const v=fn();
  if(v&&typeof v.then==='function')return v.then(result=>{db.exec('COMMIT');return result;},error=>{db.exec('ROLLBACK');throw error;}).finally(()=>activeTransactions.delete(db));
  db.exec('COMMIT');activeTransactions.delete(db);return v;
 }catch(e){db.exec('ROLLBACK');activeTransactions.delete(db);throw e;}
}
export function listProducts(db){return db.prepare('SELECT * FROM products').all().map(r=>({...JSON.parse(r.data),stock:r.stock,reserved:r.reserved}));}
export function createOrder(db,owner,d){
 if(d?.adult!==true||!d.name?.trim()||!d.recipient?.trim()||!d.address?.trim()||!/^\+?[\d\s]{9,15}$/.test(d.phone))throw Error('Điền đủ thông tin người mua, người nhận, địa chỉ và xác nhận độ tuổi.');
 if(d.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||d.date<new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date())))throw Error('Ngày giao mong muốn không hợp lệ.');
 if(!Array.isArray(d.items)||!d.items.length||d.items.length>30)throw Error('Giỏ hàng không hợp lệ.');
 return transaction(db,()=>{
  const all=listProducts(db),map=new Map(all.map(p=>[p.id,p])),counts={};
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
  for(const [p,q]of Object.entries(counts))db.prepare('UPDATE products SET reserved=reserved+? WHERE id=?').run(q,p);
  db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').run(id,'order',owner,JSON.stringify(data),created);
  return {id,data,created};
 });
}
export function transitionOrder(db,id,status,actor){return transaction(db,()=>{
 const row=db.prepare("SELECT * FROM records WHERE id=? AND kind='order'").get(id);if(!row)throw Error('Không tìm thấy đơn.');const d=JSON.parse(row.data),steps=['Chờ xác nhận','Đã xác nhận','Đang chuẩn bị','Đang giao','Hoàn tất'];
 if(status==='Đã hủy'){if(!steps.slice(0,3).includes(d.status))throw Error('Không thể hủy ở trạng thái này.');if(!['Chưa thanh toán','Đã hoàn tiền thử nghiệm'].includes(d.payment))throw Error('Cần hoàn tiền trước khi hủy.');}
 else if(!steps.includes(d.status)||steps.indexOf(status)!==steps.indexOf(d.status)+1)throw Error('Chuyển trạng thái không hợp lệ.');
 if(status==='Đang giao'&&(d.payment!=='Đã thanh toán thử nghiệm'||d.ageVerification!=='Đã kiểm tra quy trình độ tuổi'))throw Error('Cần xác nhận thanh toán và kiểm tra độ tuổi trước khi giao.');
 if(['Đang giao','Đã hủy'].includes(status))for(const[p,q]of Object.entries(d.counts))db.prepare(status==='Đang giao'?'UPDATE products SET reserved=reserved-?,stock=stock-? WHERE id=?':'UPDATE products SET reserved=reserved-? WHERE id=?').run(...(status==='Đang giao'?[q,q,p]:[q,p]));
 d.status=status;d.history.push({at:new Date().toISOString(),status,actor});db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(d),id);return d;
});}
