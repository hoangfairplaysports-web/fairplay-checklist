-- Bỏ 1 việc routine/họp riêng ngày đó (ẩn, không bị sinh lại). Chỉ quản lý được ẩn.
alter table public.cl_tasks add column if not exists hidden boolean not null default false;

create or replace function public.cl_tasks_guard() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.created_at := old.created_at;
    if auth.uid() is not null and not public.cl_is_admin() then
      new.owner_id := old.owner_id; new.source := old.source; new.assigned_by := old.assigned_by;
      new.routine_id := old.routine_id; new.scope := old.scope; new.hidden := old.hidden;
      if old.source in ('routine', 'meeting', 'assigned') then new.title := old.title; new.date := old.date; end if;
    end if;
  elsif auth.uid() is not null and not public.cl_is_admin() then
    if new.source = 'assigned' then new.source := 'adhoc'; new.assigned_by := null; end if;
    new.hidden := false;
  end if;
  if new.scope = 'private' and (new.source = 'assigned' or new.owner_id <> coalesce(auth.uid(), new.owner_id)) then
    raise exception 'Việc riêng chỉ chủ tài khoản tự tạo';
  end if;
  return new;
end $$;
