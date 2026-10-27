-- =====================================================================
-- Lịch chạy tự động (chạy SAU KHI đã deploy các Edge Function)
-- Thay 2 chỗ trước khi Run:
--   <PROJECT_REF>  = mã project Supabase (VD ralgsuvbupccjhboiafl)
--   <CRON_SECRET>  = đúng chuỗi đã đặt bằng: supabase secrets set CRON_SECRET=...
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Gỡ lịch cũ (nếu chạy lại)
select cron.unschedule(jobname) from cron.job where jobname in ('cl-notify-5m', 'cl-routines-daily', 'cl-notify-log-cleanup', 'cl-ideas-daily');

-- Mỗi 5 phút: nhắc việc, nhắc bắt đầu ngày, nhắc báo cáo, tổng kết cho quản lý
select cron.schedule('cl-notify-5m', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cl-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$);

-- 00:05 giờ Việt Nam (17:05 UTC): sinh việc routine cho ngày mới
select cron.schedule('cl-routines-daily', '5 17 * * *', $$ select public.cl_generate_routines(public.cl_today()); $$);

-- Dọn nhật ký thông báo cũ hơn 30 ngày
select cron.schedule('cl-notify-log-cleanup', '0 18 * * *', $$ delete from public.cl_notify_log where sent_at < now() - interval '30 days'; $$);

-- 07:30 giờ Việt Nam (00:30 UTC), thứ 2 – thứ 7: AI tạo gợi ý mỗi ngày và gửi thông báo
select cron.schedule('cl-ideas-daily', '30 0 * * 1-6', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cl-ideas',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
