# Pháo Thủ Online

Game bắn súng theo lượt, lấy cảm hứng từ Gunny. Mỗi người điều khiển một xe tăng, chỉnh góc và lực rồi bắn. Gió đổi sau mỗi lượt, đạn nổ đục thủng địa hình, xe tăng rơi xuống hố vừa tạo ra. Phòng chơi từ 2 đến 4 người, có thể thêm máy để chơi một mình.

Client dùng Canvas thuần, server dùng Node.js và Socket.IO. Không có file ảnh hay âm thanh nào: xe tăng vẽ bằng code, tiếng nổ tổng hợp bằng Web Audio.

## Chạy thử

Cần Node.js 18 trở lên.

```bash
npm install
npm start
```

Mở http://localhost:3000, nhập tên rồi bấm "Tạo phòng mới". Muốn thử nhanh một mình thì bấm "+ Thêm máy" trong phòng chờ rồi "Bắt đầu".

Chơi với bạn trong cùng mạng Wi-Fi: mở `http://<địa chỉ IP máy bạn>:3000` trên máy kia. Chơi qua internet thì đưa thư mục này lên một dịch vụ chạy Node.js (Render, Railway, Fly.io) hoặc mở đường hầm bằng ngrok hoặc cloudflared. Server đọc cổng từ biến môi trường `PORT`.

## Chạy bằng Docker Desktop

Cần Docker Desktop đang hoạt động. Mở terminal tại thư mục dự án rồi chạy:

```bash
docker compose up --build
```

Mở http://localhost:3000 để chơi. Dừng container bằng `Ctrl+C`; chạy nền bằng `docker compose up --build -d` và dừng bằng `docker compose down`.

## Cách chơi

| Thao tác | Phím |
| --- | --- |
| Đi trái, đi phải | A, D hoặc ←, → |
| Nâng, hạ nòng | W, S hoặc ↑, ↓ (giữ Shift để chỉnh mịn) |
| Tăng, giảm lực | E, Q hoặc lăn chuột trên màn hình |
| Chọn đạn | 1, 2, 3 |
| Bắn | Space, Enter hoặc nút BẮN |
| Ngắm bằng chuột | Giữ và kéo trên màn hình: hướng kéo là góc, độ dài là lực |
| Tắt, bật tiếng | M |

Mỗi lượt có 30 giây và 150 đơn vị xăng để di chuyển. Hết giờ là mất lượt. Người cuối cùng còn sống thắng. Xe rơi xuống vực (hố đào xuyên tới đáy bản đồ) cũng bị loại.

Ba loại đạn: đạn thường (vô hạn), đạn lớn (nổ rộng, sát thương cao, 2 viên), ba tia (bắn ba viên lệch nhau 6 độ, 2 lượt).

## Cấu trúc thư mục

```
shared/config.js      hằng số dùng chung: kích thước bản đồ, vật lý, vũ khí
server/physics.js     sinh địa hình, đục lỗ, mô phỏng đường bay của đạn
server/game.js        luật chơi: lượt, di chuyển, bắn, sát thương, thắng thua
server/bot.js         bot tự tính góc và lực
server/room.js        phòng chơi, chủ phòng, thêm hoặc xóa máy
server/index.js       Express + Socket.IO, nối sự kiện mạng vào Room và Game
public/index.html     giao diện: menu, phòng chờ, HUD, màn hình kết quả
public/css/style.css
public/js/main.js     kết nối server, đọc phím và chuột, vòng lặp game
public/js/render.js   vẽ nền, địa hình, xe tăng, hiệu ứng nổ
public/js/sound.js    âm thanh tổng hợp
test/logic.js         kiểm thử không cần mạng
test/smoke.js         kiểm thử đầy đủ qua Socket.IO
```

## Cách hoạt động

**Server quyết định mọi thứ.** Client chỉ gửi ý định (`game:aim`, `game:move`, `game:fire`). Khi có người bắn, server mô phỏng toàn bộ đường bay, tính sát thương, đục địa hình, cho xe rơi xuống chỗ mới, rồi gửi một sự kiện `game:shot` chứa đường bay đầy đủ và kết quả. Client chỉ phát lại: mỗi frame đưa viên đạn tới điểm kế tiếp trên đường bay, tới điểm cuối thì nổ. Cách này khiến mọi người thấy cùng một kết quả và không ai sửa được số liệu ở phía client.

**Vật lý.** Đạn bay theo chuyển động ném xiên cộng gia tốc ngang của gió. Mỗi frame chia thành 4 bước nhỏ để đạn nhanh không xuyên qua đất mỏng. Góc đo từ trục ngang: 0 là bắn sang phải, 90 là thẳng lên, 180 là sang trái.

**Địa hình.** Server giữ một bitmap 1600×800 (1 là đất, 0 là trống). Địa hình ban đầu là tổng của ba sóng sin với tham số ngẫu nhiên. Vụ nổ xóa một hình tròn trên bitmap. Client nhận mảng chiều cao ban đầu, dựng ra một canvas riêng và đục cùng một hình tròn bằng `destination-out`, nên hai bên luôn khớp nhau mà không phải gửi lại cả ảnh.

**Bot.** Với mỗi lượt, bot thử khoảng 1400 cặp góc và lực bằng chính hàm mô phỏng của server, chọn cặp rơi gần mục tiêu nhất, bỏ qua những phát nổ quá gần mình, rồi cộng sai số nhỏ cho đỡ máy móc.

**Sự kiện mạng.**

| Hướng | Sự kiện |
| --- | --- |
| Client gửi | `room:create`, `room:join`, `room:addBot`, `room:removeBot`, `room:start`, `room:leave`, `game:aim`, `game:move`, `game:fire` |
| Server gửi | `room:update`, `game:start`, `game:turn`, `game:aim`, `game:move`, `game:shot`, `game:msg`, `game:left`, `game:over` |

## Chỉnh cân bằng game

Mọi con số nằm trong `shared/config.js`: trọng lực, ảnh hưởng của gió, tốc độ đạn, máu, xăng, thời gian mỗi lượt, bán kính nổ và sát thương từng loại đạn. Thêm vũ khí mới thì thêm một mục vào `WEAPONS` và `WEAPON_ORDER`. Server và nút chọn đạn trên giao diện tự nhận ra, chỉ cần phím tắt nếu muốn dùng số lớn hơn 3.

## Kiểm thử

```bash
npm run test:logic   # vật lý, luật chơi, bot, phòng chơi; không cần mạng
npm test             # chạy bài trên, rồi thêm kiểm thử qua Socket.IO thật
```

## Hạn chế hiện tại

- Mất kết nối giữa ván là bị loại, chưa có vào lại.
- Trạng thái nằm trong bộ nhớ một tiến trình, chưa chia được nhiều server.
- Chưa có chat, đội, bảng xếp hạng, người xem.
- Canvas có độ phân giải cố định 1600×800 và co giãn bằng CSS, nên trên màn hình mật độ điểm ảnh cao hình sẽ hơi mềm.

## Hướng mở rộng

Chuyển sang TypeScript: đổi đuôi `.js` thành `.ts`, thêm `tsconfig.json`, chạy server bằng `tsx` và build client bằng Vite hoặc esbuild. Dùng Phaser: chỉ cần thay `render.js` và phần vẽ trong `main.js`, vì server không biết gì về cách client vẽ. Phần địa hình thì giữ canvas riêng và đưa vào Phaser như một texture động.
