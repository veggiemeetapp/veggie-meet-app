# VeggieMeet iOS TestFlight – lỗi Google Login `redirect_uri_mismatch`

## 1. Trạng thái hiện tại

- Ứng dụng VeggieMeet đã được upload lên TestFlight.
- Bản đang kiểm tra: `1.0 (3)`.
- Bundle ID: `app.veggiemeet.ios`.
- Khi chọn **Login with Google**, ứng dụng đã mở được trang đăng nhập Google nhưng Google trả về:

```text
Error 400: redirect_uri_mismatch
```

Đây là lỗi cấu hình OAuth trên Google Cloud, không phải lỗi tài khoản Google của người dùng và không phải do TestFlight bị hỏng.

## 2. Nguyên nhân

Luồng đăng nhập hiện tại gồm hai lần chuyển hướng khác nhau:

```text
iOS app
  → Supabase Auth
  → Google OAuth
  → Supabase callback
  → iOS app callback
```

Hai URL liên quan là:

### URL Google trả kết quả về Supabase

```text
https://bmlchfrhdcafyfysnfok.supabase.co/auth/v1/callback
```

Đây là `redirect_uri` mà Google đang kiểm tra. URL này phải được đăng ký chính xác trong OAuth Client trên Google Cloud.

### URL Supabase trả kết quả về ứng dụng iOS

```text
app.veggiemeet.ios://auth/callback
```

Đây là deep link của ứng dụng. URL này phải nằm trong **Supabase → Authentication → URL Configuration → Redirect URLs**.

Google không kiểm tra deep link `app.veggiemeet.ios://auth/callback`. Google chỉ kiểm tra callback HTTPS của Supabase. Vì callback Supabase chưa có trong danh sách **Authorized redirect URIs** của đúng Google OAuth Client nên Google từ chối yêu cầu.

> Việc bản web vẫn đăng nhập được không chứng minh cấu hình iOS đã đúng. Web production có thể đi qua luồng OAuth/broker khác, trong khi bản iOS đang gọi trực tiếp Google provider được cấu hình trong Supabase.

### Phát hiện sau khi Justin kiểm tra Google Cloud

Trong Google Cloud project **VeggieMeet Production**, Justin nhìn thấy một Web application client có Client ID bắt đầu bằng:

```text
108482264417-m921...
```

Tuy nhiên, request bị lỗi trên TestFlight lại gửi Client ID:

```text
440665643513-298ns6ci96g537pn3eik66nqmn293bt7.apps.googleusercontent.com
```

Hai Client ID này không giống nhau. Điều đó cho thấy Supabase Google Provider hiện đang dùng client `440665...`, nhưng Justin đang mở Google Cloud project chứa client `108482...`. Source iOS không hardcode hai Client ID này; ứng dụng gọi Supabase và Supabase chọn Client ID từ cấu hình Google Provider.

Vì vậy, chỉ thêm callback vào client `108482...` là chưa đủ nếu Supabase vẫn dùng `440665...`. Google sẽ tiếp tục nhận request cho `440665...` và vẫn báo lỗi.

## 3. Thông tin cấu hình hiện tại

| Mục | Giá trị |
| --- | --- |
| Supabase project ref | `bmlchfrhdcafyfysnfok` |
| Google callback cần đăng ký | `https://bmlchfrhdcafyfysnfok.supabase.co/auth/v1/callback` |
| iOS callback | `app.veggiemeet.ios://auth/callback` |
| Client ID xuất hiện trong request lỗi TestFlight | `440665643513-298ns6ci96g537pn3eik66nqmn293bt7.apps.googleusercontent.com` |
| Client Justin nhìn thấy trong VeggieMeet Production | Bắt đầu bằng `108482264417-m921...` — cần mở client để lấy giá trị đầy đủ |
| Loại OAuth Client cần dùng | Web application |

Các URL phải khớp tuyệt đối, bao gồm giao thức, domain, path và dấu `/`. Không thêm dấu `/` ở cuối callback Supabase.

## 4. Justin (Owner) cần làm trước

Justin cần thực hiện phần này vì anh ấy sở hữu hoặc quản lý Google Cloud và Supabase của dự án. Các bước có thể làm trên bất kỳ máy tính nào; không cần Xcode hoặc macOS.

### Bước 1 — xác nhận Client ID Supabase đang sử dụng

1. Mở **Supabase → Authentication → Sign In / Providers → Google**.
2. Xem trường **Client ID** nhưng không thay đổi ngay.
3. Nếu giá trị là `440665...`, cấu hình Supabase khớp với request lỗi TestFlight và xác nhận chênh lệch trong ảnh Google Cloud.
4. Không chụp hoặc gửi **Client Secret**.

Sau khi xác nhận, chọn một trong hai cách bên dưới. Ưu tiên Cách A nếu Justin tìm được Google Cloud project sở hữu client `440665...`; nếu không tìm được, dùng Cách B.

### Cách A — tìm và cập nhật client `440665...`

1. Mở [Google Cloud Console – OAuth Clients](https://console.cloud.google.com/auth/clients).
2. Kiểm tra các Google Cloud project hoặc tài khoản khác mà Justin quản lý.
3. Tìm OAuth Client có Client ID đầy đủ:

   ```text
   440665643513-298ns6ci96g537pn3eik66nqmn293bt7.apps.googleusercontent.com
   ```

4. Mở client đó và xác nhận loại ứng dụng là **Web application**.
5. Trong **Authorized redirect URIs**, thêm chính xác:

   ```text
   https://bmlchfrhdcafyfysnfok.supabase.co/auth/v1/callback
   ```

6. Giữ nguyên các URI đang có và nhấn **Save**.
7. Chờ khoảng vài phút để cấu hình được cập nhật rồi báo cho developer kiểm tra lại.

Không thêm callback trên vào **Authorized JavaScript origins**. Không thêm `app.veggiemeet.ios://auth/callback` vào Google Cloud.

### Cách B — dùng client `108482...` mà Justin đang quản lý

Nếu Justin không tìm thấy hoặc không có quyền với client `440665...`, có thể chuyển Supabase sang client đang có trong project **VeggieMeet Production**:

1. Nhấn vào client **VeggieMeet Production** trong ảnh và lấy Client ID đầy đủ bắt đầu bằng `108482...`.
2. Xác nhận loại client là **Web application**.
3. Trong **Authorized redirect URIs**, thêm chính xác:

   ```text
   https://bmlchfrhdcafyfysnfok.supabase.co/auth/v1/callback
   ```

4. Không xóa các URI đang tồn tại. Nhấn **Save**.
5. Lấy Client ID đầy đủ và Client Secret thuộc **chính client `108482...` này**.
6. Mở **Supabase → Authentication → Sign In / Providers → Google**.
7. Thay cả **Client ID** và **Client Secret** bằng cặp thông tin của client `108482...` rồi lưu.
8. Xác nhận trong **Supabase → Authentication → URL Configuration → Redirect URLs** vẫn có:

   ```text
   app.veggiemeet.ios://auth/callback
   ```

9. Chờ vài phút rồi developer kiểm tra cả TestFlight và web.

Không được ghép Client ID của client này với Client Secret của client khác.

### Cách C — tạo OAuth Client mới nếu cần

Chỉ dùng cách này nếu client `108482...` không phù hợp hoặc Justin muốn tách riêng client cho Supabase.

1. Trong Google Cloud project **VeggieMeet Production**, tạo OAuth Client mới.
2. Chọn application type **Web application**.
3. Có thể đặt tên `VeggieMeet Supabase`.
4. Thêm **Authorized redirect URI**:

   ```text
   https://bmlchfrhdcafyfysnfok.supabase.co/auth/v1/callback
   ```

5. Lấy **Client ID** và **Client Secret** mới.
6. Mở **Supabase → Authentication → Sign In / Providers → Google**.
7. Thay Client ID và Client Secret cũ bằng thông tin mới rồi lưu.
8. Xác nhận trong **Supabase → Authentication → URL Configuration → Redirect URLs** vẫn có:

   ```text
   app.veggiemeet.ios://auth/callback
   ```

Không gửi Client Secret qua Telegram, ảnh chụp màn hình hoặc commit vào Git. Justin nên tự nhập secret vào Supabase hoặc chia sẻ bằng một trình quản lý mật khẩu an toàn.

## 5. Developer cần làm sau khi Justin hoàn tất

Không cần tạo build TestFlight mới nếu Justin chỉ sửa Authorized redirect URI hoặc thay OAuth Client trong Supabase, vì đây là cấu hình phía server.

1. Chờ vài phút sau khi Justin lưu cấu hình Google Cloud.
2. Đóng hoàn toàn ứng dụng TestFlight rồi mở lại.
3. Đi theo luồng:

   ```text
   Onboarding → Login with Google → chọn tài khoản Google
   ```

4. Kiểm tra luồng thành công:

   ```text
   Google
     → https://bmlchfrhdcafyfysnfok.supabase.co/auth/v1/callback
     → app.veggiemeet.ios://auth/callback
     → ứng dụng VeggieMeet
   ```

5. Kiểm tra thêm các trường hợp:
   - Đăng nhập bằng tài khoản đã tồn tại.
   - Đăng nhập bằng tài khoản mới.
   - Hủy đăng nhập hoặc nhấn Back ở trang Google.
   - Logout rồi login lại.
   - Đóng và mở lại ứng dụng để xác nhận session được giữ đúng.

6. Nếu lỗi vẫn còn, mở **Error details** trên trang lỗi Google và ghi lại:
   - `client_id`
   - `redirect_uri`
   - Thời điểm xảy ra lỗi

   Không ghi hoặc chia sẻ Client Secret. So sánh `redirect_uri` Google báo với URL đã đăng ký; chúng phải giống từng ký tự.

7. Nếu Google đã đăng nhập thành công nhưng ứng dụng không mở lại, kiểm tra tiếp:
   - Deep link `app.veggiemeet.ios://auth/callback` trong Supabase Redirect URLs.
   - URL scheme trong `ios/App/App/Info.plist`.
   - Native OAuth bridge trong `src/lib/nativeOAuth.ts` và `src/components/auth/NativeAuthBridge.tsx`.
   - Authentication logs trong Supabase.

## 6. Thứ tự thực hiện

1. **Justin làm trước:** kiểm tra Client ID trong Supabase Google Provider.
2. **Justin chọn một cấu hình thống nhất:** sửa đúng client `440665...`, hoặc thêm callback vào client `108482...` rồi cập nhật cả Client ID và Client Secret tương ứng trong Supabase.
3. **Justin báo đã Save** và chỉ gửi Client ID cùng ảnh phần Authorized redirect URIs; không gửi Client Secret.
4. **Developer làm sau:** kiểm tra lại ngay trên bản TestFlight hiện tại và kiểm tra hồi quy bản web.
5. Chỉ sửa code và upload build mới nếu Google đã chấp nhận callback nhưng app vẫn không nhận được deep link hoặc không hoàn tất session.

## 7. Tiêu chí hoàn thành

- Không còn màn hình `Error 400: redirect_uri_mismatch`.
- Người dùng chọn được tài khoản Google.
- Google trả về Supabase thành công.
- Supabase mở lại ứng dụng bằng `app.veggiemeet.ios://auth/callback`.
- Ứng dụng tạo được session và chuyển vào màn hình phù hợp.
- Đăng xuất và đăng nhập lại vẫn hoạt động.
- Luồng đăng nhập Google trên web không bị ảnh hưởng.

## 8. Tài liệu tham khảo

- [Supabase: Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase: Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
