import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,createOrder,listProducts,transitionOrder,transaction} from '../backend/db.mjs';
const setup=()=>{const db=openDatabase(':memory:');db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('u','test@example.invalid','Test','unused','customer');return db;};
const order=(extra={})=>({adult:true,name:'Người mua',recipient:'Người nhận',phone:'0901234567',address:'Địa chỉ thử nghiệm',items:[{qty:1,parts:['w1','box1','card'],message:'Cảm ơn'}],...extra});
test('server calculates price and keeps the original order snapshot',()=>{const db=setup();const o=createOrder(db,'u',order({total:1}));assert.equal(o.data.total,1595000);const p=listProducts(db).find(p=>p.id==='w1');db.prepare('UPDATE products SET data=? WHERE id=?').run(JSON.stringify({...p,price:5}),'w1');assert.equal(JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(o.id).data).items[0].parts[0].price,1250000);assert.equal(listProducts(db).find(p=>p.id==='box1').reserved,1);db.close();});
test('insufficient component rolls back every stock reservation',()=>{const db=setup();db.prepare("UPDATE products SET stock=0 WHERE id='card'").run();assert.throws(()=>createOrder(db,'u',order()),/Không đủ tồn kho/);assert.equal(listProducts(db).find(p=>p.id==='w1').reserved,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n,0);db.close();});
test('sequential competing orders cannot oversell',()=>{const db=setup();db.prepare("UPDATE products SET stock=1 WHERE id='w1'").run();createOrder(db,'u',order());assert.throws(()=>createOrder(db,'u',order()),/Không đủ tồn kho/);assert.equal(listProducts(db).find(p=>p.id==='w1').reserved,1);db.close();});
test('cancel restores all reservations once and forbids duplicate cancellation',()=>{const db=setup(),o=createOrder(db,'u',order());transitionOrder(db,o.id,'Đã hủy','u');assert.equal(listProducts(db).find(p=>p.id==='w1').reserved,0);assert.equal(listProducts(db).find(p=>p.id==='box1').stock,40);assert.throws(()=>transitionOrder(db,o.id,'Đã hủy','u'),/Không thể hủy/);db.close();});
test('dispatch requires payment and age check, and deducts stock only once',()=>{const db=setup(),o=createOrder(db,'u',order());transitionOrder(db,o.id,'Đã xác nhận','u');transitionOrder(db,o.id,'Đang chuẩn bị','u');assert.throws(()=>transitionOrder(db,o.id,'Đang giao','u'),/thanh toán/);const row=db.prepare('SELECT * FROM records WHERE id=?').get(o.id),d=JSON.parse(row.data);d.payment='Đã thanh toán thử nghiệm';d.ageVerification='Đã kiểm tra quy trình độ tuổi';db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(d),o.id);transitionOrder(db,o.id,'Đang giao','u');assert.equal(listProducts(db).find(p=>p.id==='w1').stock,23);assert.equal(listProducts(db).find(p=>p.id==='w1').reserved,0);assert.throws(()=>transitionOrder(db,o.id,'Đang giao','u'),/không hợp lệ/);db.close();});
test('invalid quantities, gift capacity and skipped status are rejected',()=>{const db=setup();assert.throws(()=>createOrder(db,'u',order({items:[{qty:1.5,parts:['w1']}]})));assert.throws(()=>createOrder(db,'u',order({items:[{qty:1,parts:['w1','w2','box1']}]})),/không phù hợp/);assert.throws(()=>createOrder(db,'u',order({adult:false})));const o=createOrder(db,'u',order());assert.throws(()=>transitionOrder(db,o.id,'Hoàn tất','u'),/không hợp lệ/);db.close();});
test('outer transaction rolls back order and stock when quote conversion fails',()=>{const db=setup();assert.throws(()=>transaction(db,()=>{createOrder(db,'u',order());throw Error('conversion failed');}));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n,0);assert.equal(listProducts(db).find(p=>p.id==='w1').reserved,0);db.close();});

import {expireReservations} from '../backend/expire.mjs';
test('unpaid pending reservations expire after 24 hours',()=>{const db=setup();const o=createOrder(db,'u',order());assert.equal(expireReservations(db,Date.now()+86401000),1);assert.equal(listProducts(db).find(p=>p.id==='w1').reserved,0);assert.equal(JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get(o.id).data).status,'Đã hủy');db.close();});
test('API enforces roles, isolation, quote approval and idempotent payment',async()=>{
 process.env.NODE_ENV='test';process.env.DB_CLIENT='sqlite';process.env.COMMERCE_ENABLED='false';process.env.COOKIE_SECURE='false';process.env.DB_PATH=':memory:';process.env.ADMIN_EMAIL='admin@example.invalid';process.env.ADMIN_PASSWORD='Testing-Only-Password-2026';
 const {server}=await import('../backend/index.mjs');await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 async function req(path,body,cookie){const r=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json','Origin':base}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 try{
  assert.equal((await req('orders')).status,401);
  const a=await req('auth',{action:'login',email:'admin@example.invalid',password:'Testing-Only-Password-2026'});assert.equal(a.status,200);assert.match(a.cookie,/al_session=/);
  const c=await req('auth',{action:'register',email:'customer@example.invalid',password:'Customer-Password-2026',name:'Khách A'});assert.equal(c.status,200);assert.equal(c.data.user.role,'customer');
  assert.equal((await req('members',undefined,c.cookie)).status,403);
  assert.equal((await req('stock',{id:'w1',delta:1,reason:'hack'},c.cookie)).status,403);
  const o=await req('orders',order(),c.cookie);assert.equal(o.status,201);
  const created=o.data.id;
  assert.equal((await req('order-action',{id:created,action:'pay'},c.cookie)).status,403);
  assert.equal((await req('order-action',{id:created,action:'pay'},a.cookie)).status,200);
  assert.equal((await req('order-action',{id:created,action:'pay'},a.cookie)).status,200);
  let own=(await req('orders',undefined,c.cookie)).data;assert.equal(own[0].data.history.filter(h=>h.action==='pay').length,1);
  const other=await req('auth',{action:'register',email:'other@example.invalid',password:'Other-Password-2026',name:'Khách B'});
  assert.equal((await req('orders',undefined,other.cookie)).data.length,0);
  assert.equal((await req('order-action',{id:created,action:'status',status:'Đã hủy'},other.cookie)).status,403);
  const q=await req('quotes',{company:'Doanh nghiệp QA',name:'Khách A',email:'customer@example.invalid',phone:'0901234567',quantity:2,budget:'2 triệu'},c.cookie);assert.equal(q.status,201);
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  assert.equal((await req('quote-action',{id:q.data.id,action:'version',amount:3110000,parts:['w1','box1','card'],note:'Báo giá QA',validUntil:tomorrow},a.cookie)).status,200);
  assert.equal((await req('convert-quote',{id:q.data.id,address:'QA'},a.cookie)).status,400);
  assert.equal((await req('quote-action',{id:q.data.id,action:'approve'},c.cookie)).status,200);
  assert.equal((await req('convert-quote',{id:q.data.id,address:'Địa chỉ doanh nghiệp'},a.cookie)).status,200);
  assert.equal((await req('convert-quote',{id:q.data.id,address:'Địa chỉ doanh nghiệp'},a.cookie)).status,400);
  const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR0cAAAAASUVORK5CYII=';
  const uploaded=await req('upload',{data:pixel},a.cookie);assert.equal(uploaded.status,200);
  assert.equal((await fetch(base+'/uploads/'+uploaded.data.id)).status,401);
  const imageProduct={id:'qa-photo',name:'Ảnh QA',price:1000,type:'Vang đỏ',country:'QA',brand:'QA',volume:'750 ml',alcohol:'13%',tone:'#592c30',active:true,images:[uploaded.data.id]};
  assert.equal((await req('products',{product:imageProduct},c.cookie)).status,403);
  assert.equal((await req('products',{product:imageProduct},a.cookie)).status,200);
  assert.equal((await fetch(base+'/uploads/'+uploaded.data.id)).status,200);
  assert.equal((await req('upload',{data:'data:image/svg+xml;base64,PHN2Zy8+'},a.cookie)).status,400);
  const out=await req('auth',{action:'logout'},c.cookie);assert.equal(out.status,200);assert.equal((await req('orders',undefined,c.cookie)).status,401);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
