import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const file=process.env.DB_PATH||'data/shop.sqlite';if(!existsSync(file))throw Error('Chưa có cơ sở dữ liệu để sao lưu.');
mkdirSync('backups',{recursive:true});const output=resolve('backups','shop-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
const db=new DatabaseSync(file);db.exec("VACUUM INTO '"+output.replaceAll("'","''")+"'");db.close();console.log('Đã sao lưu: '+output);
