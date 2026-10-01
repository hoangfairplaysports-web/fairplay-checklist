# Fairplay Checklist

Checklist công việc hằng ngày + báo cáo ngày/tuần + KPI cho team Marketing & Kinh doanh Fairplay Sports.

- **Giao diện**: web tĩnh (Preact + htm, không cần build), host trên GitHub Pages, cài được lên điện thoại như app.
- **Dữ liệu + đăng nhập**: Supabase — **dùng chung project với Fairplay CRM** (chung tài khoản). Bảng của app này có tiền tố `cl_`.
- **Thông báo**: thông báo đẩy của app (Web Push) + bot Telegram. Cron Supabase chạy mỗi 5 phút.
- **Trợ lý AI**: Google Gemini (function calling), chỉ dành cho Quản lý, chat trong app hoặc Telegram.
- `js/config.js` để trống → app chạy **chế độ DEMO** với dữ liệu mẫu.

## Phân quyền (kiểm soát ở cơ sở dữ liệu – RLS)

| | Nhân viên | Quản lý | BOD |
|---|:-:|:-:|:-:|
| Checklist, báo cáo của mình | ✓ | ✓ | |
| Xem checklist/báo cáo của nhân viên khác | | ✓ | ✓ |
| Việc riêng 🔒 của Quản lý | | chỉ chính chủ | |
| Giao việc, duyệt báo cáo, KPI, routine, nghỉ phép, nhân sự | | ✓ | |
| Giờ "Bắt đầu ngày làm việc" | máy chủ ghi, không sửa được | | |

Tài khoản thêm từ Checklist mặc định **không** vào được CRM (cột `profiles.crm_access`), trừ khi tick "Cho phép dùng cả Fairplay CRM".

## Cài đặt (làm 1 lần)

### 1. Cơ sở dữ liệu
Supabase (project CRM) → **SQL Editor → New query** → dán toàn bộ `supabase/schema.sql` → **Run**.
Script tạo bảng `cl_*`, phân quyền, routine mẫu, và thêm `hoangfairplaysports@gmail.com` làm Quản lý.

### 2. Đưa giao diện lên GitHub Pages
```bash
gh repo create hoangfairplaysports-web/fairplay-checklist --public --source . --push
gh api -X POST repos/hoangfairplaysports-web/fairplay-checklist/pages -f "source[branch]=main" -f "source[path]=/"
```
App chạy tại `https://hoangfairplaysports-web.github.io/fairplay-checklist/`.
Supabase → **Authentication → URL Configuration → Redirect URLs**: thêm địa chỉ trên (để link "Quên mật khẩu" hoạt động).

### 3. Bot Telegram & Gemini
- Telegram: nhắn **@BotFather** → `/newbot` → đặt tên → nhận **token**. Ghi tên bot (không có @) vào `TELEGRAM_BOT` trong `js/config.js`.
- Gemini: bật **Developer Benefits** của gói Google AI Pro tại google.dev (gắn tín dụng $10/tháng vào 1 Google Cloud project) → vào **aistudio.google.com → Get API key** → tạo key trong đúng project đó.
- Điền 2 giá trị vào `supabase/.secrets.local` (file này không lên GitHub): `TELEGRAM_BOT_TOKEN=` và `GEMINI_API_KEY=`.

### 4. Deploy phần máy chủ
```bash
npx supabase login
npx supabase secrets set --env-file supabase/.secrets.local --project-ref ralgsuvbupccjhboiafl
npx supabase functions deploy cl-admin-users cl-notify cl-telegram cl-ai --project-ref ralgsuvbupccjhboiafl --use-api
```
Nối webhook Telegram (thay TOKEN và SECRET bằng giá trị trong `.secrets.local`):
```bash
curl "https://api.telegram.org/botTOKEN/setWebhook" -d "url=https://ralgsuvbupccjhboiafl.supabase.co/functions/v1/cl-telegram" -d "secret_token=SECRET"
```

### 5. Lịch chạy tự động
SQL Editor → dán `supabase/cron.local.sql` (bản đã điền sẵn, không lên GitHub; mẫu gốc là `supabase/cron.sql`) → **Run**.

### 6. Bắt đầu dùng
1. Đăng nhập bằng tài khoản Quản lý → **Cài đặt → Nhân sự → + Thêm người** (email + mật khẩu tạm) cho từng nhân viên/BOD.
2. **Cài đặt → Routine**: sửa danh sách việc lặp lại cho từng phòng; **KPI → + Thêm KPI**.
3. Mỗi người: **Thông báo → Bật trên thiết bị này** (từng máy/điện thoại) và **Liên kết Telegram**.
   iPhone: mở bằng Safari → Chia sẻ → *Thêm vào Màn hình chính*, mở app từ biểu tượng rồi mới bật thông báo.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `js/` | Giao diện. `store.js` = dữ liệu (demo/thật), `today.js` = checklist, `team.js`/`stats.js`/`weekly.js`/`kpi.js` = quản lý |
| `sw.js` | Service worker nhận thông báo đẩy |
| `supabase/schema.sql` | Bảng, phân quyền, hàm sinh routine |
| `supabase/functions/` | `cl-admin-users` (tạo tài khoản), `cl-notify` (nhắc việc, cron), `cl-telegram` (webhook bot), `cl-ai` (trợ lý Gemini) |
| `supabase/cron.sql` | Lịch cron (pg_cron + pg_net) |
