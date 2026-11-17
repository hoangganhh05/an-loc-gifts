import http from 'node:http';
import {scryptSync,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnvFile} from 'node:process';
import {expireReservations} from './expire.mjs';
const envPath=fileURLToPath(new URL('./.env',import.meta.url));
if(existsSync(envPath))loadEnvFile(envPath);
const mysqlMode=process.env.DB_CLIENT==='mysql';
const database=await import(mysqlMode?'./mysql-db.mjs':'./db.mjs');
const {openDatabase,listProducts,createOrder,transitionOrder,transaction}=database;
const db=await openDatabase(mysqlMode?{}:(process.env.DB_PATH||'data/shop.sqlite'));
const uid=()=>crypto.randomUUID(),stamp=()=>new Date().toISOString();
const hash=p=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(p,salt,64).toString('hex');};
const verify=(p,h)=>{try{const[s,k]=h.split(':');return timingSafeEqual(Buffer.from(k,'hex'),scryptSync(p,s,64));}catch{return false;}};
const tokenHash=t=>createHash('sha256').update(t).digest('hex');
const log=async (actor,action)=>await db.prepare('INSERT INTO audit VALUES (?,?,?,?)').run(uid(),actor,action,stamp());
const adminEmail=process.env.ADMIN_EMAIL?.trim().toLowerCase(),adminPassword=process.env.ADMIN_PASSWORD;
if(adminEmail&&adminPassword){if(adminPassword.length<12)throw Error('ADMIN_PASSWORD phải có ít nhất 12 ký tự.');if(!await db.prepare('SELECT 1 FROM users WHERE email=?').get(adminEmail))await db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(uid(),adminEmail,'Quản trị viên',hash(adminPassword),'admin');}
const rate=new Map();
const limit=(key,max=30)=>{const n=Date.now();let r=rate.get(key);if(!r||r.until<n){r={count:0,until:n+60000};rate.set(key,r);}if(++r.count>max)throw Object.assign(Error('Thao tác quá nhanh. Vui lòng thử lại sau một phút.'),{status:429});};
setInterval(async()=>{await expireReservations(db);for(const[k,v]of rate)if(v.until<Date.now())rate.delete(k);await db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());},60000).unref();
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const fail=(msg,status=400)=>{throw Object.assign(Error(msg),{status});};
async function body(req){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>2500000)fail('Tệp hoặc dữ liệu quá lớn.',413);chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{fail('Dữ liệu JSON không hợp lệ.');}}
const staff=u=>u&&['admin','sales','warehouse'].includes(u.role);
const allow=(u,roles)=>{if(!u)fail('Vui lòng đăng nhập.',401);if(!roles.includes(u.role))fail('Bạn không có quyền thực hiện thao tác này.',403);};
const record=async (id,kind)=>{const r=await db.prepare('SELECT * FROM records WHERE id=? AND kind=?').get(id,kind);if(!r)fail('Không tìm thấy dữ liệu.',404);return {...r,data:JSON.parse(r.data)};};
const update=async r=>db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(r.data),r.id);
const safeUser=u=>u?{id:u.id,email:u.email,name:u.name,role:u.role}:null;
const cookie=(res,t,clear=false)=>res.setHeader('Set-Cookie',`al_session=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear?0:604800}${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);
const publicRoot=resolve(fileURLToPath(new URL('../frontend/dist/',import.meta.url)));
export const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: https://images.unsplash.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
 try{
  const url=new URL(req.url,'http://localhost'),path=url.pathname;
  const token=decodeURIComponent((req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('al_session='))?.slice(11)||'');
  const u=token?await db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(tokenHash(token),Date.now()):null;
  if(path.startsWith('/api/')){
   if(req.method==='POST'){
    const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)fail('Nguồn yêu cầu không hợp lệ.',403);
    if(!String(req.headers['content-type']||'').startsWith('application/json'))fail('Yêu cầu phải dùng JSON.',415);
    limit(req.socket.remoteAddress+':writes',120);
   }
   if(path==='/api/health')return json(res,{ok:true,mode:process.env.COMMERCE_ENABLED==='true'?'live-review-required':'sandbox'});
   if(path==='/api/catalog'&&req.method==='GET')return json(res,{products:(await listProducts(db)).filter(p=>staff(u)||p.active),user:safeUser(u),sandbox:process.env.COMMERCE_ENABLED!=='true'});
   if(path==='/api/me'&&req.method==='GET')return json(res,{user:safeUser(u),setupRequired:!await db.prepare("SELECT 1 FROM users WHERE role='admin'").get()});
   if(path==='/api/auth'&&req.method==='POST'){
    limit(req.socket.remoteAddress+':auth',12);const b=await body(req);
    if(b.action==='logout'){if(token)await db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(token));cookie(res,'',true);return json(res,{ok:true});}
    const login=String(b.email||'').trim().toLowerCase(),adminAlias=b.action==='login'&&login==='admin',email=adminAlias?(adminEmail||'admin.donhang@anloc.local'):login,minLength=b.action==='register'?10:8;if(!/^\S+@\S+\.\S+$/.test(email)||typeof b.password!=='string'||b.password.length<minLength||b.password.length>128)fail(b.action==='register'?'Email hợp lệ và mật khẩu từ 10 đến 128 ký tự.':'Nhập email hoặc tài khoản admin và mật khẩu từ 8 đến 128 ký tự.');
    if(b.action==='register'){
     if(!b.name?.trim())fail('Vui lòng nhập họ tên.');if(await db.prepare('SELECT 1 FROM users WHERE email=?').get(email))fail('Không thể đăng ký với email này.');
     await db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(uid(),email,b.name.trim().slice(0,100),hash(b.password),'customer');
    }else if(b.action!=='login')fail('Yêu cầu không hợp lệ.');
    const user=await db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!user||adminAlias&&user.role!=='admin'||!verify(b.password,user.password))fail('Tài khoản hoặc mật khẩu chưa đúng.',401);
    const t=randomBytes(32).toString('hex');await db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(t),user.id,Date.now()+604800000);cookie(res,t);return json(res,{user:safeUser(user)});
   }
   if(!u)fail('Vui lòng đăng nhập để tiếp tục.',401);
   if(path==='/api/orders'&&req.method==='GET'){
    const rows=staff(u)?await db.prepare("SELECT * FROM records WHERE kind='order' ORDER BY created DESC LIMIT 300").all():await db.prepare("SELECT * FROM records WHERE kind='order' AND owner=? ORDER BY created DESC LIMIT 300").all(u.id);
    return json(res,rows.map(r=>({...r,data:JSON.parse(r.data)})));
   }
   if(path==='/api/orders'&&req.method==='POST'){
    if(process.env.COMMERCE_ENABLED==='true')fail('Vận hành thật đang khóa cho đến khi hoàn tất tích hợp thanh toán và rà soát kinh doanh.',503);
    const b=await body(req);limit(u.id+':order',10);const order=await createOrder(db,u.id,b);await log(u.id,`Tạo đơn ${order.id}`);return json(res,order,201);
   }
   if(path==='/api/order-action'&&req.method==='POST'){
    const b=await body(req),r=await record(b.id,'order');
    if(b.action==='status'){
     if(!staff(u)){if(r.owner!==u.id||b.status!=='Đã hủy'||r.data.status!=='Chờ xác nhận')fail('Không thể cập nhật đơn này.',403);}
     else if(u.role==='warehouse'&&!['Đang chuẩn bị','Đang giao','Hoàn tất'].includes(b.status))fail('Không có quyền.',403);
     await transitionOrder(db,b.id,b.status,u.id);
    }else{
     allow(u,['admin','sales']);if(['Đã hủy','Hoàn tất'].includes(r.data.status))fail('Đơn đã kết thúc.');
     if(b.action==='pay'){if(r.data.payment==='Đã thanh toán thử nghiệm')return json(res,{ok:true});if(process.env.COMMERCE_ENABLED==='true')fail('Chưa cấu hình cổng thanh toán thực tế.');if(r.data.payment==='Đã hoàn tiền thử nghiệm')fail('Đơn đã hoàn tiền.');r.data.payment='Đã thanh toán thử nghiệm';}
     else if(b.action==='refund'){if(r.data.payment!=='Đã thanh toán thử nghiệm')fail('Không có thanh toán để hoàn.');r.data.payment='Đã hoàn tiền thử nghiệm';}
     else if(b.action==='age'){r.data.ageVerification='Đã kiểm tra quy trình độ tuổi';}
     else fail('Hành động không hợp lệ.');
     r.data.history.push({at:stamp(),action:b.action,actor:u.id});await update(r);
    }
    await log(u.id,`Đơn ${b.id}: ${b.action} ${b.status||''}`);return json(res,{ok:true});
   }
   if(path==='/api/quotes'&&req.method==='GET'){
    allow(u,['admin','sales','customer']);const rows=u.role==='customer'?await db.prepare("SELECT * FROM records WHERE kind='quote' AND owner=? ORDER BY created DESC").all(u.id):await db.prepare("SELECT * FROM records WHERE kind='quote' ORDER BY created DESC").all();return json(res,rows.map(r=>({...r,data:JSON.parse(r.data)})));
   }
   if(path==='/api/quotes'&&req.method==='POST'){
    const b=await body(req);if(!b.company?.trim()||!b.name?.trim()||!/^\S+@\S+\.\S+$/.test(b.email)||!/^\+?[\d\s]{9,15}$/.test(b.phone)||!Number.isSafeInteger(+b.quantity)||+b.quantity<1||+b.quantity>100000)fail('Kiểm tra thông tin liên hệ và số lượng.');
    if(b.logo&&!await db.prepare('SELECT 1 FROM uploads WHERE id=? AND owner=?').get(b.logo,u.id))fail('Logo không hợp lệ.');
    const id=uid(),data={company:b.company.slice(0,200),name:b.name.slice(0,100),email:b.email,phone:b.phone,quantity:+b.quantity,budget:String(b.budget||'').slice(0,100),date:b.date||'',note:String(b.note||'').slice(0,3000),logo:b.logo||null,status:'Mới tiếp nhận',versions:[],designs:[],history:[{at:stamp(),status:'Mới tiếp nhận'}]};await db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').run(id,'quote',u.id,JSON.stringify(data),stamp());return json(res,{id},201);
   }
   if(path==='/api/quote-action'&&req.method==='POST'){
    const b=await body(req),r=await record(b.id,'quote'),d=r.data;
    if(d.orderId)fail('Yêu cầu đã chuyển đơn, không thể chỉnh sửa.');
    if(b.action==='version'){
     allow(u,['admin','sales']);if(!Number.isSafeInteger(b.amount)||b.amount<0||!b.note?.trim()||!b.validUntil||!Array.isArray(b.parts)||!b.parts.length)fail('Cần số tiền, cấu hình quà, nội dung và thời hạn hiệu lực.');
     const map=new Map((await listProducts(db)).map(p=>[p.id,p]));if(b.parts.some(p=>!map.get(p)?.active))fail('Thành phần không hợp lệ.');
     const expected=b.parts.reduce((n,p)=>n+map.get(p).price,0)*d.quantity;if(b.amount!==expected)fail('Bản đầu hỗ trợ báo giá theo giá danh mục; số tiền chưa khớp.');
     d.versions.push({at:stamp(),amount:b.amount,note:b.note.slice(0,3000),validUntil:b.validUntil,parts:b.parts,version:d.versions.length+1});d.status='Chờ khách duyệt';d.designApproved=false;d.acceptedVersion=null;
    }else if(b.action==='design'){
     allow(u,['admin','sales']);if(!await db.prepare('SELECT 1 FROM uploads WHERE id=? AND owner=?').get(b.upload,u.id))fail('Mẫu không hợp lệ.');d.designs.push({upload:b.upload,at:stamp(),version:d.designs.length+1});d.designApproved=false;d.status='Chờ duyệt mẫu';
    }else{
     if(r.owner!==u.id)fail('Chỉ khách gửi yêu cầu được phê duyệt.',403);
     if(b.action==='approve'){if(!d.versions.length)fail('Chưa có báo giá.');if(new Date(d.versions.at(-1).validUntil+'T23:59:59+07:00')<new Date())fail('Báo giá hết hiệu lực.');d.status='Chấp thuận báo giá';d.acceptedVersion=d.versions.at(-1).version;}
     else if(b.action==='revise')d.status='Yêu cầu chỉnh sửa';
     else if(b.action==='approveDesign'){if(!d.designs.length)fail('Chưa có mẫu thiết kế.');if(d.acceptedVersion!==d.versions.at(-1)?.version)fail('Cần chấp thuận báo giá trước khi duyệt mẫu.');d.designApproved=true;d.status='Đã duyệt mẫu';}
     else fail('Hành động không hợp lệ.');
    }
    d.history.push({at:stamp(),status:d.status});await update(r);await log(u.id,`Báo giá ${b.id}: ${b.action}`);return json(res,{ok:true});
   }
   if(path==='/api/convert-quote'&&req.method==='POST'){
    if(process.env.COMMERCE_ENABLED==='true')fail('Chưa hoàn tất tích hợp vận hành thật.',503);
    allow(u,['admin','sales']);const b=await body(req),r=await record(b.id,'quote'),d=r.data,v=d.versions.at(-1);
    if(d.orderId||!['Chấp thuận báo giá','Đã duyệt mẫu'].includes(d.status)||!v||d.acceptedVersion!==v.version||d.logo&&!d.designApproved)fail('Báo giá hoặc mẫu chưa đủ điều kiện chuyển đơn.');
    if(new Date(v.validUntil+'T23:59:59+07:00')<new Date())fail('Báo giá hết hiệu lực.');
    const liveMap=new Map((await listProducts(db)).map(p=>[p.id,p]));if(v.parts.reduce((sum,id)=>sum+(liveMap.get(id)?.price||0),0)*d.quantity!==v.amount)fail('Giá danh mục đã thay đổi. Cần lập báo giá mới và được khách duyệt lại.');
    const o=await transaction(db,async()=>{const fresh=await record(b.id,'quote');if(fresh.data.orderId)fail('Yêu cầu đã chuyển đơn.');const createdOrder=await createOrder(db,r.owner,{adult:true,name:d.name,recipient:d.name,phone:d.phone,address:b.address,date:d.date,note:`Đơn doanh nghiệp ${d.company}; báo giá ${r.id}`,items:[{qty:d.quantity,parts:v.parts}]});d.orderId=createdOrder.id;d.status='Đã chuyển đơn';await update(r);return createdOrder;});
    await log(u.id,`Chuyển báo giá ${r.id} thành đơn ${o.id}`);return json(res,o);
   }
   if(path==='/api/upload'&&req.method==='POST'){
    const b=await body(req),raw=String(b.data||''),match=raw.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);if(!match)fail('Chỉ chấp nhận PNG, JPEG hoặc WebP.');const bytes=Buffer.from(match[2],'base64');if(bytes.length>1500000)fail('Tệp tối đa 1,5 MB.');
    const signature=bytes.subarray(0,12).toString('hex');if(!(signature.startsWith('89504e470d0a1a0a')||signature.startsWith('ffd8ff')||signature.startsWith('52494646')&&signature.slice(16,24)==='57454250'))fail('Nội dung tệp không hợp lệ.');
    const id=uid();await db.prepare('INSERT INTO uploads VALUES (?,?,?,?)').run(id,u.id,match[1],bytes);return json(res,{id});
   }
   if(path==='/api/products'&&req.method==='POST'){
    allow(u,['admin']);const b=await body(req),p=b.product;
    if(p?.type==='Hộp'&&![1,2].includes(Number(p.capacity||parseInt(p.volume))))fail('Hộp quà cần sức chứa một hoặc hai chai.');
    if(!p?.name?.trim()||!Number.isSafeInteger(p.price)||p.price<0||!['Vang đỏ','Vang trắng','Vang sủi','Whisky','Cognac','Hộp','Phụ kiện'].includes(p.type)||!/^#[a-f\d]{6}$/i.test(p.tone||''))fail('Tên, loại, giá hoặc màu sản phẩm không hợp lệ.');
    p.id=p.id||uid();if(!/^[\w-]{1,64}$/.test(p.id))fail('Mã không hợp lệ.');
    const images=Array.isArray(p.images)?p.images.slice(0,6):[];for(const image of images){if(typeof image!=='string'||!await db.prepare('SELECT 1 FROM uploads WHERE id=?').get(image))fail('Ảnh sản phẩm không hợp lệ.');}
    const data={images,capacity:p.type==='Hộp'?Number(p.capacity||parseInt(p.volume)):null,id:p.id,name:p.name.slice(0,150),price:p.price,type:p.type,country:String(p.country||'').slice(0,100),brand:String(p.brand||'').slice(0,100),volume:String(p.volume||'').slice(0,50),alcohol:String(p.alcohol||'').slice(0,30),note:String(p.note||'').slice(0,2000),tone:p.tone,active:p.active!==false};
    const productSql=mysqlMode?'INSERT INTO products (id,data,stock,reserved) VALUES (?, ?, 0, 0) ON DUPLICATE KEY UPDATE data=VALUES(data)':'INSERT INTO products VALUES (?,?,0,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data';
    await db.prepare(productSql).run(p.id,JSON.stringify(data));await log(u.id,`Cập nhật sản phẩm ${p.id}`);return json(res,{ok:true});
   }
   if(path==='/api/stock'&&req.method==='POST'){
    allow(u,['admin','warehouse']);const b=await body(req);if(!Number.isSafeInteger(b.delta)||Math.abs(b.delta)>100000||!b.reason?.trim())fail('Cần số lượng nguyên và lý do.');
    await transaction(db,async()=>{const p=await db.prepare('SELECT * FROM products WHERE id=?').get(b.id);if(!p||p.stock+b.delta<p.reserved)fail('Tồn không thể thấp hơn số đang giữ.');await db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(b.delta,b.id);await log(u.id,`Kho ${b.id}: ${b.delta}; ${b.reason.slice(0,500)}`);});return json(res,{ok:true});
   }
   if(path==='/api/customers'&&req.method==='GET'){
    allow(u,['admin','sales']);const rows=await db.prepare("SELECT id,email,name FROM users WHERE role='customer'").all();const customers=[];for(const c of rows){const orders=(await db.prepare("SELECT data FROM records WHERE owner=? AND kind='order'").all(c.id)).map(r=>JSON.parse(r.data));const n=await db.prepare("SELECT data FROM records WHERE owner=? AND kind='note'").get(c.id);customers.push({...c,orders:orders.length,total:orders.filter(o=>o.payment==='Đã thanh toán thử nghiệm').reduce((a,o)=>a+o.total,0),note:n?JSON.parse(n.data).note:''});}return json(res,customers);
   }
   if(path==='/api/customer-note'&&req.method==='POST'){allow(u,['admin','sales']);const b=await body(req);if(!await db.prepare('SELECT 1 FROM users WHERE id=?').get(b.id))fail('Không tìm thấy khách.');const old=await db.prepare("SELECT id FROM records WHERE owner=? AND kind='note'").get(b.id);if(old)await db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({note:String(b.note||'').slice(0,2000)}),old.id);else await db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').run(uid(),'note',b.id,JSON.stringify({note:String(b.note||'').slice(0,2000)}),stamp());return json(res,{ok:true});}
   if(path==='/api/members'&&req.method==='GET'){allow(u,['admin']);return json(res,await db.prepare('SELECT id,name,email,role FROM users').all());}
   if(path==='/api/members'&&req.method==='POST'){allow(u,['admin']);const b=await body(req);if(u.id===b.id||!['admin','sales','warehouse','customer'].includes(b.role))fail('Vai trò không hợp lệ hoặc đang sửa tài khoản hiện tại.');await db.prepare('UPDATE users SET role=? WHERE id=?').run(b.role,b.id);await log(u.id,`Phân quyền ${b.id}: ${b.role}`);return json(res,{ok:true});}
   if(path==='/api/audit'&&req.method==='GET'){allow(u,['admin','warehouse']);return json(res,await db.prepare('SELECT * FROM audit ORDER BY created DESC LIMIT 300').all());}
   fail('Không tìm thấy API.',404);
  }
  if(path.startsWith('/uploads/')){
   const r=await db.prepare('SELECT * FROM uploads WHERE id=?').get(path.slice(9));if(!r)fail('Không tìm thấy tệp.',404);const publicImage=(await listProducts(db)).some(p=>p.active&&p.images?.includes(r.id));if(publicImage){res.writeHead(200,{'Content-Type':r.mime,'Cache-Control':'public, max-age=3600'});return res.end(r.body);}if(!u)fail('Vui lòng đăng nhập.',401);
   const linked=await db.prepare("SELECT 1 FROM records WHERE kind='quote' AND owner=? AND data LIKE ?").get(u.id,'%'+r.id+'%');if(r.owner!==u.id&&!['admin','sales'].includes(u.role)&&!linked)fail('Không có quyền.',403);
   res.writeHead(200,{'Content-Type':r.mime,'Cache-Control':'private, no-store'});return res.end(r.body);
  }
  if(req.method!=='GET'&&req.method!=='HEAD')fail('Phương thức không hỗ trợ.',405);
  let file=resolve(publicRoot,'.'+decodeURIComponent(path));if(!file.startsWith(publicRoot+'/')&&!file.startsWith(publicRoot+'\\')&&file!==publicRoot)fail('Đường dẫn không hợp lệ.',403);
  if(!existsSync(file)||!statSync(file).isFile())file=resolve(publicRoot,'index.html');if(!existsSync(file)){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Backend Node.js đang hoạt động. Mở frontend tại http://127.0.0.1:5173 khi chạy npm run dev.');}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(req.method==='HEAD'?undefined:readFileSync(file));
 }catch(e){const status=e.status||400;json(res,{error:/constraint failed/i.test(e.message)?'Dữ liệu không hợp lệ hoặc tồn kho vừa thay đổi.':e.message},status);}
});
if(process.env.NODE_ENV!=='test')server.listen(Number(process.env.PORT||3001),process.env.HOST||'127.0.0.1',()=>{log('system',`An Lộc Gifts · Node.js API & website: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3001} · ${process.env.COMMERCE_ENABLED==='true'?'review required':'SANDBOX'}`);});
