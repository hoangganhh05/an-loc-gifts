import {transitionOrder} from './db.mjs';
export function expireReservations(db,at=Date.now()){
 const rows=db.prepare("SELECT * FROM records WHERE kind='order'").all();
 if(rows?.then)return rows.then(async items=>{let count=0;for(const r of items){const d=JSON.parse(r.data);if(d.status==='Chờ xác nhận'&&d.payment==='Chưa thanh toán'&&at-new Date(r.created).getTime()>86400000){await transitionOrder(db,r.id,'Đã hủy','system:expired');count++;}}return count;});
 let count=0;for(const r of rows){const d=JSON.parse(r.data);if(d.status==='Chờ xác nhận'&&d.payment==='Chưa thanh toán'&&at-new Date(r.created).getTime()>86400000){transitionOrder(db,r.id,'Đã hủy','system:expired');count++;}}
 return count;
}
