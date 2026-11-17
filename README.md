# An Lộc Gifts — React frontend / Node.js backend

Website thương mại điện tử rượu quà tặng phong cách cổ điển: nâu gỗ sồi #4A2E1B, #8B5A2B, vàng kim, nền kem. Toàn bộ giao diện tiếng Việt, responsive.

## Cấu trúc

- frontend/: React 19 + Vite, các trang khách hàng và quản trị.
- backend/: Node.js HTTP API, xác thực, phân quyền, nghiệp vụ và SQLite.
- tests/: kiểm thử nghiệp vụ và HTTP API.
- outputs/: ảnh kiểm tra desktop/mobile, không thuộc mã triển khai.

Không sử dụng Next.js hoặc Cloudflare để chạy backend. Máy chủ Node.js phục vụ cả API và frontend đã build. Node.js >=22.13 được yêu cầu cho node:sqlite; nên dùng bản Node đáp ứng yêu cầu engines của Vite trong package-lock.

## Chạy nhanh

Tại thư mục an-loc-gifts:

    npm install
    npm run setup
    npm run dev

- Frontend: http://127.0.0.1:5173
- Backend: http://127.0.0.1:3001/api/health
- Lệnh setup tạo backend/.env và in email/mật khẩu quản trị ngẫu nhiên trong terminal. Giữ kín tệp này, không commit.
- Email mặc định khi setup: admin@anloc.local. Không có mật khẩu quản trị hardcode.
- Mở website, vào biểu tượng tài khoản để đăng nhập. Mở Tài khoản → Quản trị hoặc #admin.
- Nếu backend/.env đã có, setup giữ nguyên. Cấu hình ADMIN_EMAIL/ADMIN_PASSWORD trước lần khởi động đầu để khởi tạo quản trị viên. Thay đổi biến sau đó không tự ghi đè mật khẩu đã lưu trong DB.
- Có thể dùng MySQL bằng cách đặt `DB_CLIENT=mysql`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` và `MYSQL_DATABASE` trong `backend/.env`. Backend tự tạo database, bảng và dữ liệu mẫu khi khởi động; mặc định vẫn dùng SQLite nếu không đặt `DB_CLIENT`.
- Khách hàng có thể tự đăng ký. Tài khoản mới luôn là customer. Admin phân quyền cho người đã đăng ký tại mục Phân quyền.

## Chạy riêng hai phần

Terminal 1:

    cd backend
    npm run dev

Terminal 2:

    cd frontend
    npm run dev

Các dependency được quản lý bằng npm workspaces: chạy npm install tại thư mục gốc. Frontend proxy /api và /uploads sang backend, cookie cùng nguồn ở trình duyệt.

## Build và chạy bản hoàn chỉnh

Từ thư mục gốc:

    npm run build
    npm start

Mở http://127.0.0.1:3001. Backend phục vụ frontend/dist; không cần chạy Vite khi dùng bản build.

Triển khai Node.js: cài dependency theo lockfile, build frontend, cấu hình backend/.env, giữ ổ đĩa bền vững cho backend/data, chạy npm start sau HTTPS reverse proxy. Đặt COOKIE_SECURE=true khi dùng HTTPS. Bản này chưa được triển khai lên hosting. Site đăng ký trong .openai là bước chuẩn bị trước khi yêu cầu công nghệ được đổi sang Node.js; chưa có phiên bản được xuất bản và không phải URL chạy ứng dụng.

## Các chức năng đã triển khai

### Khách hàng

- Vào xem sản phẩm trực tiếp; xác nhận người mua/người nhận đủ 18 tuổi tại bước đặt hàng.
- Danh mục rượu, tìm kiếm, bộ lọc loại/xuất xứ/thương hiệu/giá/còn hàng, sắp xếp, phân trang khi có hơn 6 sản phẩm.
- Chi tiết sản phẩm với giá, dung tích, độ cồn, mô tả và tồn có thể bán.
- Ghép tối đa 2 chai, chọn hộp phù hợp, thiệp, dụng cụ mở và lời chúc; xem trước, tính tiền và sửa bộ quà trong giỏ.
- Giỏ được lưu trong trình duyệt; tài khoản, đơn, kho, báo giá và tệp được lưu SQLite phía máy chủ.
- Đăng ký/đăng nhập/đăng xuất, mật khẩu băm scrypt với salt riêng, cookie HttpOnly/SameSite, phiên lưu dạng token băm và hết hạn 7 ngày.
- Đặt đơn bằng tài khoản, người mua/người nhận riêng, địa chỉ, ngày giao mong muốn và ghi chú. Không hỗ trợ tra cứu công khai bằng mã đơn; chỉ chủ đơn và nhân viên được phân quyền truy cập.
- Yêu cầu doanh nghiệp, logo, yêu cầu nhiều địa chỉ, xem các phiên bản báo giá/mẫu, chấp thuận hoặc yêu cầu chỉnh sửa.
- Giới thiệu, liên hệ và chính sách dự thảo có nhãn rõ.

### Quản trị / nhân viên

- Vai trò admin, sales, warehouse, customer. Kiểm tra quyền ở máy chủ cho mọi API.
- Admin quản lý và ẩn sản phẩm, phân quyền; không xóa sản phẩm đã dùng trong đơn.
- Danh mục mẫu khởi tạo một lần, đánh dấu minh họa. Chai và bộ quà dùng SVG/CSS minh họa cục bộ, không phụ thuộc ảnh bên ngoài.
- Quản lý đơn, thanh toán/hoàn tiền thử nghiệm, kiểm tra quy trình độ tuổi, lịch sử xử lý.
- Quản lý từng chai/hộp/thiệp/phụ kiện: tồn thực tế, đang giữ, có thể bán; nhập/điều chỉnh có lý do và nhật ký.
- Giữ tồn ngay khi tạo đơn. Giao dịch SQLite BEGIN IMMEDIATE và CHECK ngăn bán vượt tồn; mọi lỗi hoàn tác toàn bộ. Hủy đơn hoàn giữ; bàn giao giao hàng xuất kho. Đơn chờ xác nhận chưa thanh toán quá 24 giờ được tự hủy khi máy chủ chạy kiểm tra mỗi phút.
- Giá/tên/cấu hình được chụp vào đơn tại thời điểm đặt, thay đổi sản phẩm không làm sai đơn cũ.
- Báo giá doanh nghiệp theo giá danh mục, phiên bản và thời hạn; gửi mẫu thiết kế PNG/JPEG/WebP; cần khách duyệt báo giá và mẫu có logo trước khi chuyển thành đơn.
- Giá thay đổi sau báo giá sẽ chặn chuyển đơn và yêu cầu báo giá mới. Chuyển báo giá/giữ kho nằm trong cùng giao dịch và chặn chuyển trùng.
- Khách hàng, lịch sử mua, ghi chú nội bộ, báo cáo theo khoảng ngày, đối chiếu đơn, sản phẩm theo số lượng, khách mua lại.
- Doanh thu thử nghiệm gồm tổng tiền đơn đã ghi nhận thanh toán (kể cả phí giao), loại trừ đã hoàn tiền. Chưa có giá vốn nên không hiển thị lợi nhuận.

## Kiểm thử

    npm test

Bao gồm giá do server tính, bản chụp đơn, thiếu thành phần, cạnh tranh tồn, hủy trùng, điều kiện giao, chuyển trạng thái, giao dịch lồng khi đổi báo giá, hết hạn giữ hàng, phân quyền API, cô lập khách, báo giá và ghi nhận thanh toán lặp.

Đã build React thành công và kiểm tra Chrome headless ở desktop/mobile. Ảnh trong outputs/desktop.png và outputs/mobile.png. Không coi đây là đo hiệu năng thực địa hoặc kiểm thử mọi trình duyệt.

## Sao lưu / khôi phục

Trong backend:

    npm run backup

SQLite VACUUM INTO tạo bản nhất quán trong backend/backups/, bao gồm người dùng, đơn, kho, nhật ký và ảnh tải lên (BLOB). Giữ backup ngoài thư mục công khai; bảo vệ như dữ liệu khách hàng. .env cần được lưu an toàn riêng.

Khôi phục: dừng backend, giữ bản sao hiện tại, thay backend/data/shop.sqlite bằng bản backup; bảo đảm không còn tiến trình sử dụng tệp và xử lý các tệp WAL/SHM đi kèm của bản cũ trước khi khởi động. Không trộn tệp WAL của hai bản DB. Luôn kiểm tra bản phục hồi trên môi trường riêng trước.

## Giới hạn cần hoàn thiện trước khi kinh doanh thật

- Website hiện là sandbox. Đơn và thanh toán là thử nghiệm, chưa có cổng thu tiền, webhook, vận chuyển, email/SMS hoặc hóa đơn điện tử.
- COMMERCE_ENABLED=true sẽ khóa tạo đơn thông thường và từ chối thanh toán thử nghiệm, không tự biến thành tích hợp thật.
- Quy trình độ tuổi có khai báo và bước xác nhận nội bộ nhưng chưa có nhà cung cấp xác minh độc lập hay xác minh người nhận ngoài đời; chưa thể tuyên bố tuân thủ pháp luật.
- Thông tin pháp nhân, nguồn gốc rượu, nội dung quảng bá, giấy phép/điều kiện kinh doanh, thủ tục thương mại điện tử và các chính sách cần được chủ cửa hàng rà soát.
- Yêu cầu nhiều người nhận được lưu dưới ghi chú doanh nghiệp; bản đầu chuyển thành một đơn với địa chỉ được nhân viên xác nhận. Chưa tự chia lô giao nhiều địa chỉ.
- Báo giá phiên bản đầu theo giá danh mục, chưa có chiết khấu/in logo định giá riêng tự động. Nhân viên ghi rõ yêu cầu trong nội dung báo giá.
- Danh mục mẫu đang dùng minh họa SVG. Admin có thể tải tối đa 6 ảnh sản phẩm thật, xem gallery ở chi tiết. Ảnh sản phẩm đang hiển thị là công khai; logo và mẫu thiết kế được kiểm soát quyền. Tệp hỗ trợ PNG/JPEG/WebP tối đa 1,5 MB với kiểm tra chữ ký tệp.
- Chưa có quên mật khẩu, xác minh email, tích điểm, AI, kế toán hoặc nhiều chi nhánh; các chức năng này không thuộc phiên bản cơ bản hiện tại.
- SQLite phù hợp một máy chủ có ổ bền vững; chưa hỗ trợ nhiều Node replica cùng chia sẻ một file hoặc triển khai serverless không có ổ bền vững.
- MySQL được hỗ trợ cho môi trường chạy nhiều kết nối; tài khoản MySQL cần quyền tạo database khi khởi động lần đầu. Không đưa mật khẩu MySQL vào mã nguồn hoặc commit.
- Font từ Google Fonts; khi mất mạng dùng font dự phòng serif/sans-serif. Có thể tự lưu font để triển khai hoàn toàn độc lập.

Kiểm tra responsive: 24 tổ hợp của 6 trang (trang chủ, danh mục, tạo quà, doanh nghiệp, giỏ, quản trị) ở 375/768/1024/1440 px không phát hiện cuộn ngang hoặc ngoại lệ JavaScript trong phiên Chrome kiểm tra. Chi tiết trong outputs/responsive-checks.json. Đăng nhập quản trị đã kiểm tra qua proxy Vite.

Chạy nhanh trên Windows: nhấp đúp CHAY-WEB.bat ở thư mục cha, rồi mở http://127.0.0.1:5173. Nhấn Ctrl+C trong cửa sổ chạy để dừng. File tự cài thư viện khi chưa có và tạo cấu hình quản trị nếu thiếu.

