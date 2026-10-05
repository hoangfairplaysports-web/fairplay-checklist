-- Giá trị báo giá + nghiệm thu cho ev_events
alter table public.ev_events add column if not exists quote_subtotal numeric;
alter table public.ev_events add column if not exists quote_fee numeric;
alter table public.ev_events add column if not exists quote_vat numeric;
alter table public.ev_events add column if not exists quote_total numeric;
alter table public.ev_events add column if not exists accepted_at date;      -- ngày ký biên bản nghiệm thu
alter table public.ev_events add column if not exists accept_note text;
-- Ẩn giá trị tiền khỏi người không phải Admin: tách view không có cột tiền cho nhân viên
create or replace view public.ev_events_public with (security_invoker = true) as
