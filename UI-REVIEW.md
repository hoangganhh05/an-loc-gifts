# Rà soát dự án và tối ưu giao diện

Ngày rà soát: 17/11/2026.

## Chức năng hiện có

- Frontend React và backend Node.js tách riêng, chạy bằng CHAY-WEB.bat ở thư mục cha.
- Danh mục, tìm kiếm, lọc, chi tiết và ảnh sản phẩm.
- Tạo bộ quà với chai rượu, hộp phù hợp, phụ kiện, thiệp và lời chúc.
- Giỏ hàng, sửa bộ quà, đăng ký/đăng nhập và theo dõi đơn riêng theo tài khoản.
- Quản trị sản phẩm, đơn, tồn thực tế/đang giữ/có thể bán và nhật ký.
- Yêu cầu doanh nghiệp, logo, phiên bản báo giá, mẫu thiết kế, phê duyệt và chuyển đơn.
- Khách hàng, ghi chú, phân quyền và báo cáo doanh thu thử nghiệm.
- Lưu dữ liệu SQLite; mã hiện tại cũng có hỗ trợ MySQL. Lần rà soát này kiểm thử nghiệp vụ bằng SQLite, không kiểm chứng kết nối MySQL thực tế.
- Thanh toán/hoàn tiền đang là thử nghiệm; chưa tích hợp thanh toán và vận chuyển thực tế.

## Thay đổi giao diện đã thực hiện

Áp dụng ui-ux-pro-max: chữ dễ đọc, nhãn rõ, vùng bấm rộng, hỗ trợ bàn phím, thông báo trạng thái và giảm chuyển động. Giữ bảng màu nâu gỗ/vàng kim và các tùy chỉnh giao diện đã có.

- Nội dung chính và ô nhập dùng chữ 16 px; nhãn 14 px, thông tin phụ từ 12–14 px.
- Nút chính và biểu tượng trên thanh điều hướng có vùng bấm ít nhất 44 × 44 px; tăng khoảng cách giữa các nút.
- Nút thêm sản phẩm có chữ “Thêm vào giỏ”, trạng thái “Hết hàng” và thông báo kèm lối vào giỏ.
- Menu chuyển sang dạng thu gọn sớm hơn để tránh chen chữ trên tablet; tài khoản vẫn truy cập được trên điện thoại.
- Bộ lọc có thể mở/thu gọn trên màn hình nhỏ; số bộ lọc đang dùng, kết quả tìm kiếm và thao tác xóa lọc rõ ràng.
- Chọn rượu thể hiện trạng thái đã chọn bằng chữ, dấu chọn và aria-pressed; hiển thị số chai, tổng tiền, lý do khi không thể thêm bộ quà.
- Nhắc đăng nhập ở đầu bước đặt hàng và biểu mẫu doanh nghiệp; giữ nội dung khi mở/đóng hộp đăng nhập.
- Có lựa chọn hiện mật khẩu; nhãn/hướng dẫn biểu mẫu liên kết với trường nhập.
- Thông báo lỗi được phân biệt với thành công bằng nội dung, biểu tượng và role.
- Tăng cỡ chữ bảng quản trị, báo cáo và các trạng thái đơn; bảng rộng cuộn trong vùng riêng.
- Giữ hỗ trợ reduced-motion và kiểm tra focus/nhãn điều khiển trong các luồng đã chạy.

## Phạm vi mã thay đổi

Chỉ sửa frontend/src/App.jsx, Shop.jsx, shared.jsx, main.jsx; thêm frontend/src/usability.css. Không sửa backend, cấu hình MySQL, dependency hoặc dữ liệu kinh doanh.

## Kiểm tra

- npm run build: đạt.
- npm test: 9/9 đạt, chạy với SQLite.
- Chrome headless: 35 tổ hợp (7 trang × 375/390/768/1024/1440 px), không phát hiện cuộn ngang toàn trang hoặc ngoại lệ JavaScript.
- Đã chạy thao tác thêm giỏ/lối vào giỏ, giữ thông tin khi đóng đăng nhập, hiện mật khẩu, chọn/bỏ chọn chai, thay đổi tổng giá, lọc/xóa lọc, menu điện thoại và đăng nhập quản trị.
- Đã kiểm tra ô nhập 16 px, vùng bấm chính >=44 px, reduced-motion và bố cục tương đương phóng to 200% cho danh mục, giỏ, quản trị.
- Chụp và xem lại ảnh desktop/mobile. Chi tiết: outputs/ui-review/checks.json; ảnh trong outputs/ui-review/.

Các kiểm tra này không thay thế kiểm thử với người dùng thực, mọi trình duyệt hoặc đánh giá đầy đủ WCAG. Backend kiểm tra giao diện dùng SQLite trong bộ nhớ và cổng riêng, không sử dụng dữ liệu kinh doanh thật.
