// Kết nối Supabase (dùng chung project với Fairplay CRM).
// Để trống = chế độ DEMO (dữ liệu mẫu, lưu trên trình duyệt).
// Anon key là khoá công khai, an toàn khi để trong code — dữ liệu được bảo vệ bằng phân quyền (RLS).
export const CONFIG = {
  SUPABASE_URL: 'https://ralgsuvbupccjhboiafl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_-7K-xoTavAHvvsApZIYJFg_un3KkWwx',
  // Khoá công khai VAPID cho thông báo đẩy (tạo bằng: npx web-push generate-vapid-keys)
  VAPID_PUBLIC_KEY: 'BNGWg8X-Wt5IwDqWxAn--2U065V3u5j1sEP5m1QPAYMZNWNowuP4BStm44Yqsf0giV5DkAgHzIl-QHNUVUsaH8Q',
  // Tên bot Telegram (không có @), VD: FairplayChecklistBot
  TELEGRAM_BOT: 'fridayofnh10bot',
};
