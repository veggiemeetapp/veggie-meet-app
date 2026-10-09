# Owner đăng ký App ID cho VeggieMeet

## Việc owner cần làm ngay bây giờ

Owner chỉ cần đăng ký App ID sau một lần:

```text
app.veggiemeet.ios
```

Lập trình viên đã có **Admin trong App Store Connect** và sẽ tự làm tất cả các phần việc còn lại có thể được ủy quyền.

## Cách đăng ký App ID

1. Owner đăng nhập [Apple Developer](https://developer.apple.com/account/).
2. Mở **Certificates, Identifiers & Profiles**.
3. Chọn **Identifiers**.
4. Tìm:

   ```text
   app.veggiemeet.ios
   ```

5. Nếu đã tồn tại, không tạo lại. Gửi ảnh hoặc xác nhận cho lập trình viên.
6. Nếu chưa tồn tại, nhấn dấu cộng.
7. Chọn **App IDs**, sau đó nhấn **Continue**.
8. Chọn **App**, sau đó nhấn **Continue**.
9. Nhập chính xác:

   ```text
   Description: VeggieMeet iOS
   Bundle ID type: Explicit
   Bundle ID: app.veggiemeet.ios
   ```

10. Chưa cần bật thêm capability.
11. Nhấn **Continue**.
12. Kiểm tra lại Bundle ID và nhấn **Register**.
13. Gửi ảnh hoặc xác nhận đăng ký thành công cho lập trình viên.

## Nếu Apple hiển thị lỗi

- Nếu Apple báo Bundle ID không khả dụng, dừng lại và gửi lỗi cho lập trình viên.
- Không tự chọn Bundle ID khác.
- Nếu Apple chặn thao tác vì cần chấp nhận thỏa thuận, chỉ chấp nhận thỏa thuận mà Apple yêu cầu để tiếp tục.

## Không cần cấp thêm quyền

Lập trình viên đã có Admin trong App Store Connect nên owner không cần cấp thêm quyền nào ở thời điểm hiện tại.

Lập trình viên không thấy **Certificates, Identifiers & Profiles** vì membership là Individual. Đây là giới hạn bình thường và không ngăn lập trình viên hoàn thành phần App Store Connect còn lại.

## Dừng lại sau khi đăng ký

Owner chưa cần làm các việc sau:

- Tạo app record VeggieMeet trong App Store Connect.
- Chuẩn bị hoặc build source code.
- Mở Xcode.
- Ký hoặc upload build.
- Cấu hình TestFlight.
- Nhập thông tin sản phẩm trên App Store.

Lập trình viên sẽ liên hệ owner sau nếu cần owner xác thực khi ký và upload release build đã hoàn thành.

## Checklist hoàn thành

- [ ] `app.veggiemeet.ios` đã xuất hiện trong Identifiers.
- [ ] Đây là Explicit App ID.
- [ ] Tên chính xác là `app.veggiemeet.ios`.
- [ ] Lập trình viên đã nhận được xác nhận hoặc ảnh chụp.

Tài liệu chính thức: [Đăng ký App ID](https://developer.apple.com/help/account/identifiers/register-an-app-id/)

Kiểm tra lần cuối theo tài liệu Apple ngày 2 tháng 10 năm 2026.
