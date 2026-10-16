-- =====================================================================
-- Migration 07 - Việc giải đấu giao cho NHIỀU người phụ trách
-- ev_tasks.pic_ids = danh sách người phụ trách; pic_id giữ = người đầu tiên (tương thích CRM / dữ liệu cũ).
-- Chạy lại nhiều lần an toàn.
-- =====================================================================
alter table public.ev_tasks add column if not exists pic_ids uuid[] not null default '{}';
update public.ev_tasks set pic_ids = array[pic_id] where pic_id is not null and cardinality(pic_ids) = 0;
create index if not exists ev_tasks_pic_ids on public.ev_tasks using gin (pic_ids);

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
  end if;
  -- Đồng bộ 2 cột: ghi pic_ids → pic_id = người đầu; chỉ ghi pic_id (CRM, dữ liệu cũ) → pic_ids = [pic_id]
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

-- Ai có tên trong danh sách phụ trách đều cập nhật được trạng thái / ghi chú
drop policy if exists ev_tasks_pic on public.ev_tasks;
create policy ev_tasks_pic on public.ev_tasks for update to authenticated
  using (pic_id = auth.uid() or auth.uid() = any (pic_ids))
  with check (pic_id = auth.uid() or auth.uid() = any (pic_ids));
