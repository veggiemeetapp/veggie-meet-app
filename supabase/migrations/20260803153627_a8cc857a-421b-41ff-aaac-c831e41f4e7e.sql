insert into public.community_place_suggestions (submitted_by, city_id, place_name, address_text, official_source_url, vegan_reason, submitter_note, moderation_status)
select '447dad9b-88fa-4fe4-91c3-97ae29b04d6c', (select id from public.cities limit 1), v.name, v.addr, v.url, v.reason, v.note, 'pending'
from (values
 ('QA050 <script>alert(1)</script>', 'QA050 addr <b>bold</b> 123 Test Street', 'https://example.com/qa050-script', 'QA050 script payload check for containment testing purposes.', 'QA050 note A'),
 (repeat('A',250), repeat('B',250), 'https://example.com/'||repeat('c',200), repeat('D',250), repeat('E',250)),
 ('QA050 Nhà Hàng Thuần Chay ĐẶC BIỆT — 🌱🥗 Đường Nguyễn Thị Minh Khai Phường Bến Nghé Quận 1', 'QA050 số 12 Đường Nguyễn Đình Chiểu, Phường Đa Kao, Quận 1, Thành phố Hồ Chí Minh', 'https://example.com/qa050-unicode-đặc-biệt', 'QA050 Nhà hàng thuần chay 100% — không sử dụng sản phẩm động vật.', 'QA050 ghi chú tiếng Việt rất dài để kiểm tra ngắt dòng an toàn.'),
 ('QA050 long URL case', 'QA050 long url address', 'https://example.com/'||repeat('u',460)||'/end', 'QA050 long URL vegan reason.', 'QA050 long URL note'),
 ('QA050 long explanation case', 'QA050 long explanation address', 'https://example.com/qa050-long', repeat('Long vegan explanation sentence that keeps going. ',12), repeat('Long submitter note sentence that also keeps going. ',12))
) as v(name, addr, url, reason, note);