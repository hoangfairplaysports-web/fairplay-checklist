-- =====================================================================
-- Migration 10 - Nhập đầy đủ file checklist Excel của giải
--   * Việc giải: thêm chặng (stage), SL (qty), giờ hạn (due_time), khoá đối chiếu khi nhập lại (src_key),
--     trạng thái mới 'waiting' = Chờ khách hàng.
--   * Giải: danh sách chặng (stages) - mỗi chặng có ngày D, địa điểm riêng.
--   * ev_sheets: bảng phụ của giải (Giải thưởng, Vật tư, Run sheet, Nhân sự, Contact, Tổng quan…)
--     giữ nguyên dòng/cột như Excel. Admin sửa nội dung; mọi thành viên tick được các cột "Đã …".
-- Chạy lại nhiều lần an toàn.
-- =====================================================================
alter table public.ev_tasks add column if not exists stage text;
alter table public.ev_tasks add column if not exists qty text;
alter table public.ev_tasks add column if not exists due_time text;
alter table public.ev_tasks add column if not exists src_key text;
alter table public.ev_tasks drop constraint if exists ev_tasks_status_check;
alter table public.ev_tasks add constraint ev_tasks_status_check check (status in ('todo', 'doing', 'waiting', 'blocked', 'done'));

alter table public.ev_events add column if not exists stages jsonb not null default '[]';

-- Người phụ trách (không phải admin) chỉ đổi trạng thái / ghi chú
create or replace function public.ev_tasks_guard() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.ev_is_admin() then
    new.event_id := old.event_id; new.phase := old.phase; new.category := old.category; new.title := old.title;
    new.detail := old.detail; new.pic_id := old.pic_id; new.pic_ids := old.pic_ids; new.pic_name := old.pic_name; new.due_date := old.due_date;
    new.offset_days := old.offset_days; new.item_id := old.item_id; new.sort := old.sort;
    new.stage := old.stage; new.qty := old.qty; new.due_time := old.due_time; new.src_key := old.src_key;
  end if;
  new.pic_ids := coalesce(new.pic_ids, '{}');
  if tg_op = 'UPDATE' and new.pic_ids is distinct from old.pic_ids then
    new.pic_id := new.pic_ids[1];
  elsif tg_op = 'UPDATE' and new.pic_id is distinct from old.pic_id then
    new.pic_ids := case when new.pic_id is null then '{}'::uuid[] else array[new.pic_id] end;
  elsif new.pic_id is not null and not (new.pic_id = any (new.pic_ids)) then
    new.pic_ids := array[new.pic_id] || new.pic_ids;
  elsif new.pic_id is null and cardinality(new.pic_ids) > 0 then
    new.pic_id := new.pic_ids[1];
  end if;
  return new;
end $$;

-- Nhân viên đọc giải qua view (ẩn tiền) → thêm cột chặng
create or replace view public.ev_events_public with (security_invoker = false) as
  select id, name, client_name, customer_id, sport, venue, event_date, end_date, headcount, status, pm_id, client_contact,
    contract_signed_at, contract_deadline, accepted_at, notes, created_at, updated_at, stages
  from public.ev_events where public.ev_is_member();
grant select on public.ev_events_public to authenticated;

create table if not exists public.ev_sheets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ev_events (id) on delete cascade,
  name text not null,                     -- tên sheet trong Excel
  title text,                             -- dòng tiêu đề
  note text,                              -- dòng mô tả dưới tiêu đề
  header jsonb not null default '[]',     -- tên cột
  rows jsonb not null default '[]',       -- [{ "c": [..] }] hoặc [{ "s": "▶ CHẶNG TP.HCM" }] (dòng nhóm)
  check_cols int[] not null default '{}', -- cột tick được ("Đã nhận", "Đã đặt"…)
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists ev_sheets_event on public.ev_sheets (event_id, sort);
alter table public.ev_sheets enable row level security;
drop policy if exists ev_sheets_select on public.ev_sheets;
drop policy if exists ev_sheets_admin on public.ev_sheets;
create policy ev_sheets_select on public.ev_sheets for select to authenticated using (public.ev_is_member());
create policy ev_sheets_admin on public.ev_sheets for all to authenticated using (public.ev_is_admin()) with check (public.ev_is_admin());
grant select, insert, update, delete on public.ev_sheets to authenticated;

-- Tick 1 ô ở cột "Đã …" (mọi thành viên)
create or replace function public.ev_sheet_tick(p_id uuid, p_row int, p_col int, p_val text)
returns void language plpgsql security definer set search_path = public as $$
declare s public.ev_sheets;
begin
  if not public.ev_is_member() then raise exception 'Không có quyền'; end if;
  select * into s from public.ev_sheets where id = p_id for update;
  if s.id is null or not (p_col = any (s.check_cols)) then raise exception 'Cột này không tick được'; end if;
  if p_row < 0 or p_row >= jsonb_array_length(s.rows) or (s.rows -> p_row -> 'c') is null then raise exception 'Dòng không hợp lệ'; end if;
  update public.ev_sheets
    set rows = jsonb_set(rows, array[p_row::text, 'c', p_col::text], to_jsonb(coalesce(p_val, '')), true), updated_at = now()
    where id = p_id;
end $$;
revoke all on function public.ev_sheet_tick(uuid, int, int, text) from public;
grant execute on function public.ev_sheet_tick(uuid, int, int, text) to authenticated;

notify pgrst, 'reload schema';
