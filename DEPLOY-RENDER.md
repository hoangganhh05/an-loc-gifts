# Triển khai An Lộc Gifts lên Render

React được build vào frontend/dist; Node.js phục vụ cả website, /api và /uploads trên cùng domain. Không cần tạo Static Site hoặc cấu hình CORS riêng. Thư mục frontend và backend vẫn tách riêng.

## Đưa mã lên GitHub

Chạy tại thư mục chứa package.json và render.yaml:

```powershell
git add .
git diff --cached --stat
git commit -m "Prepare An Loc Gifts for Render"
git push -u origin main
```

Kiểm tra danh sách trước khi commit: không có backend/.env, database, ảnh xuất từ DB, outputs, node_modules hoặc mật khẩu. Remote đã đặt là https://github.com/hoangganhh05/an-loc-gifts.git. Nếu Git yêu cầu user.name/user.email, đặt thông tin Git của bạn trước khi commit.

## Tạo dịch vụ

Trong Render chọn New → Blueprint, kết nối GitHub và chọn repository an-loc-gifts, nhánh main. Render đọc render.yaml ở gốc repository. Kiểm tra cấu hình trước khi bấm tạo dịch vụ.

Hoặc New → Web Service với cấu hình thủ công:

| Mục | Giá trị |
| --- | --- |
| Runtime | Node |
| Root Directory | Để trống nếu package.json nằm ở gốc repo |
| Build Command | npm ci --include=dev && npm run build |
| Start Command | npm start |
| Health Check Path | /api/health |
| Region | Singapore, hoặc gần MySQL online |

Nếu bạn đưa cả thư mục an-loc-gifts vào repo, Root Directory phải là an-loc-gifts và render.yaml cần nằm ở gốc repo hoặc chọn đúng Blueprint path. Cấu trúc được chuẩn bị ở đây dùng package.json ngay tại gốc repo.

## Biến môi trường

Nhập trong Render Dashboard → Environment, không gửi hoặc commit mật khẩu:

| Biến | Giá trị |
| --- | --- |
| NODE_ENV | production |
| HOST | 0.0.0.0 |
| COOKIE_SECURE | true |
| COMMERCE_ENABLED | false — vẫn là bản đặt hàng/thanh toán thử nghiệm |
| DB_CLIENT | mysql |
| MYSQL_HOST | Host MySQL online do nhà cung cấp cấp; không dùng localhost/127.0.0.1 |
| MYSQL_PORT | Port MySQL online do nhà cung cấp cấp |
| MYSQL_DATABASE | Tên database có sẵn |
| MYSQL_USER | User có quyền tạo bảng, đọc/ghi trong database đó |
| MYSQL_PASSWORD | Mật khẩu MySQL online |
| MYSQL_CREATE_DATABASE | false |
| MYSQL_SSL | true nếu nhà cung cấp hỗ trợ/yêu cầu TLS |
| MYSQL_SSL_CA | Nếu cần: nội dung chứng chỉ CA của nhà cung cấp, PEM nhiều dòng hoặc ký tự \n giữa các dòng |
| ADMIN_EMAIL | Email quản trị dùng khi khởi tạo DB mới |
| ADMIN_PASSWORD | Mật khẩu mới, tối thiểu 12 ký tự, tối đa 128 ký tự |

Không tự đặt PORT: ứng dụng đọc PORT do Render cấp. .node-version cố định Node 22.16.0, tương thích Vite 8 và node:sqlite.

Nếu nhà cung cấp không hỗ trợ TLS, cần xác nhận thông số kết nối của họ trước khi đổi MYSQL_SSL=false. Không tắt xác minh chứng chỉ. Cho phép IP outbound của dịch vụ Render trong firewall MySQL nếu nhà cung cấp giới hạn IP.

ADMIN_EMAIL/ADMIN_PASSWORD chỉ tạo tài khoản nếu email chưa tồn tại; không đặt lại mật khẩu tài khoản cũ. Có thể đăng nhập bằng email đó hoặc tên admin. Sau khi tạo xong có thể xóa ADMIN_PASSWORD khỏi Environment. Nếu xóa ADMIN_EMAIL, đăng nhập bằng email thực thay cho tên admin.

## Dữ liệu hiện tại

Mã nguồn không chứa dữ liệu MySQL trên máy bạn. Dùng DB online trống sẽ tạo danh mục mẫu, không tự có các sản phẩm/ảnh/đơn đã thêm ở máy cá nhân.

Để giữ nguyên dữ liệu, xuất đầy đủ DB local rồi nhập vào DB online trước khi chạy dịch vụ lần đầu. Bao gồm users, sessions, products, records, audit, uploads và settings. Ảnh nằm trong bảng uploads. Dùng MySQL Workbench hoặc công cụ của nhà cung cấp; sao lưu DB online trước khi nhập nếu đã có dữ liệu. Không commit file SQL. Không nhập đè DB có dữ liệu thật khi chưa kiểm tra.

Nếu DB online đã là DB bạn đang dùng, không cần nhập lại. Chạy lại/redeploy vẫn giữ dữ liệu vì nằm trong MySQL online. Không chuyển sang SQLite trên ổ tạm của Render.

## Kiểm tra sau deploy

1. Mở https://<ten-dich-vu>.onrender.com/api/health: phải có ok:true.
2. Mở trang chủ và bộ sưu tập; kiểm tra ảnh tải được.
3. Đăng nhập admin, kiểm tra sản phẩm/tồn kho và đơn hàng.
4. Tạo đơn thử, tải lại trang, kiểm tra đơn và tồn kho vẫn đúng.
5. Kiểm tra cookie al_session có HttpOnly, Secure và SameSite=Lax qua DevTools.

Health hiện kiểm tra HTTP; quá trình khởi động đã kết nối/tạo bảng MySQL trước khi mở cổng. Nếu mất DB sau khi khởi động cần xem log/API catalog, không chỉ health.

Render free có thể ngủ khi không hoạt động. Đây là bản thử nghiệm, chưa tích hợp thanh toán thật.

Tài liệu: https://render.com/docs/web-services và https://render.com/docs/blueprint-spec
