import {existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(existsSync('.env')){console.log('backend/.env đã tồn tại. Hãy dùng thông tin ADMIN_EMAIL và ADMIN_PASSWORD trong tệp đó.');process.exit(0);}
const password=randomBytes(18).toString('base64url');
writeFileSync('.env','PORT=3001\nHOST=127.0.0.1\nADMIN_EMAIL=admin@anloc.local\nADMIN_PASSWORD='+password+'\nCOOKIE_SECURE=false\nCOMMERCE_ENABLED=false\n',{mode:0o600});
console.log('Đã tạo backend/.env (không đưa tệp này lên Git).');console.log('Email quản trị: admin@anloc.local');console.log('Mật khẩu quản trị: '+password);console.log('Chạy npm run dev từ thư mục gốc, đăng nhập rồi vào #admin.');
