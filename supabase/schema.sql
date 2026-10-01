-- =====================================================================
-- Fairplay Checklist — cấu trúc dữ liệu + phân quyền
-- Dùng CHUNG project Supabase với Fairplay CRM (chung tài khoản đăng nhập).
-- Mọi bảng của app này có tiền tố cl_ để không đụng bảng CRM.
-- Chạy trong Supabase: SQL Editor → New query → dán toàn bộ → Run.
-- File viết để chạy lại an toàn nhiều lần.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Vá nhỏ cho CRM: tài khoản chỉ dùng Checklist (Marketing, BOD…) không
--    tự động có quyền vào CRM. Tài khoản CRM hiện có không bị ảnh hưởng.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists crm_access boolean not null default true;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active and crm_access
$$;

-- ---------------------------------------------------------------------
-- 1. Thành viên Checklist
-- ---------------------------------------------------------------------
create table if not exists public.cl_members (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text not null,
  role text not null default 'staff' check (role in ('admin', 'staff', 'bod')),
  dept text check (dept in ('mkt', 'sales')),
  title text,
  active boolean not null default true,
  notify_push boolean not null default true,
  notify_telegram boolean not null default false,
  telegram_chat_id bigint,
  telegram_link_code text,
  created_at timestamptz not null default now()
);

create or replace function public.cl_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.cl_members where id = auth.uid() and active
$$;
create or replace function public.cl_is_admin() returns boolean
language sql stable as $$ select coalesce(public.cl_role() = 'admin', false) $$;
create or replace function public.cl_is_viewer() returns boolean  -- quản lý hoặc BOD
language sql stable as $$ select coalesce(public.cl_role() in ('admin', 'bod'), false) $$;
create or replace function public.cl_is_member() returns boolean
language sql stable as $$ select public.cl_role() is not null $$;

-- Ngày/giờ hiện tại theo giờ Việt Nam
create or replace function public.cl_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- Nhân viên chỉ được sửa cài đặt thông báo của chính mình
create or replace function public.cl_members_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not public.cl_is_admin() then
    new.role := old.role; new.dept := old.dept; new.title := old.title; new.active := old.active;
    new.full_name := old.full_name; new.email := old.email;
    new.telegram_chat_id := old.telegram_chat_id;
  end if;
  return new;
end $$;
drop trigger if exists cl_members_guard on public.cl_members;
create trigger cl_members_guard before update on public.cl_members
  for each row execute function public.cl_members_guard();

-- ---------------------------------------------------------------------
-- 2. Cài đặt chung
-- ---------------------------------------------------------------------
create table if not exists public.cl_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb
);
insert into public.cl_settings (id, data) values (1, '{
  "work_start": "09:00", "late_after": "09:00", "very_late_after": "09:30",
  "report_deadline": "17:00", "work_end": "18:00", "weekly_deadline": "14:30", "ai_model": "gemini-flash"
}'::jsonb) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. Routine, KPI, nghỉ phép
-- ---------------------------------------------------------------------
create table if not exists public.cl_routines (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  owner_id uuid references public.cl_members (id) on delete cascade,
  dept text check (dept in ('all', 'mkt', 'sales')),
  repeat text not null default 'daily' check (repeat in ('daily', 'weekdays', 'monthly')),
  days int[] not null default '{}',
  month_day int,
  "time" text,
  end_time text,
  kind text not null default 'task' check (kind in ('task', 'meeting')),
  priority text not null default 'mid',
  scope text not null default 'work' check (scope in ('work', 'private')),
  grp text,
  kpi_key text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cl_kpis (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  title text not null,
  owner_id uuid not null references public.cl_members (id) on delete cascade,
  type text not null default 'count' check (type in ('count', 'bool', 'percent')),
  target numeric not null default 1,
  period text not null default 'week' check (period in ('week', 'month', 'quarter')),
  unit text,
  manual jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cl_leaves (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references public.cl_members (id) on delete cascade,  -- null = cả công ty
  "from" date not null,
  "to" date not null,
  type text not null check (type in ('full', 'am', 'pm', 'holiday')),
  note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Công việc
-- ---------------------------------------------------------------------
create table if not exists public.cl_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.cl_members (id) on delete cascade,
  title text not null,
  date date not null default public.cl_today(),
  "time" text,
  end_time text,
  due_date date,
  source text not null default 'adhoc' check (source in ('routine', 'meeting', 'adhoc', 'assigned', 'plan')),
  routine_id uuid references public.cl_routines (id) on delete set null,
  scope text not null default 'work' check (scope in ('work', 'private')),
  grp text,
  priority text not null default 'mid' check (priority in ('high', 'mid', 'low')),
  status text not null default 'todo' check (status in ('todo', 'doing', 'blocked', 'done')),
  progress int not null default 0,
  output text,
  qty numeric,
  note text,
  block_reason text,
  need_help text,
  kpi_id uuid references public.cl_kpis (id) on delete set null,
  assigned_by uuid references public.cl_members (id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists cl_tasks_routine_uq on public.cl_tasks (routine_id, owner_id, date) where routine_id is not null;
create index if not exists cl_tasks_owner_date on public.cl_tasks (owner_id, date);
create index if not exists cl_tasks_open on public.cl_tasks (owner_id) where status <> 'done';

-- Thời điểm "xong" do máy chủ ghi; nhân viên không giao việc cho người khác, không tự ý đổi việc được giao
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
      new.routine_id := old.routine_id; new.scope := old.scope;
      if old.source in ('routine', 'meeting', 'assigned') then new.title := old.title; new.date := old.date; end if;
    end if;
  elsif auth.uid() is not null and not public.cl_is_admin() then
    if new.source = 'assigned' then new.source := 'adhoc'; new.assigned_by := null; end if;
  end if;
  if new.scope = 'private' and (new.source = 'assigned' or new.owner_id <> coalesce(auth.uid(), new.owner_id)) then
    raise exception 'Việc riêng chỉ chủ tài khoản tự tạo';
  end if;
  return new;
end $$;
drop trigger if exists cl_tasks_guard on public.cl_tasks;
create trigger cl_tasks_guard before insert or update on public.cl_tasks
  for each row execute function public.cl_tasks_guard();

-- ---------------------------------------------------------------------
-- 5. Bắt đầu ngày làm việc — giờ do MÁY CHỦ ghi, không sửa được
-- ---------------------------------------------------------------------
create table if not exists public.cl_daystarts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.cl_members (id) on delete cascade default auth.uid(),
  date date not null default public.cl_today(),
  started_at timestamptz not null default now(),
  unique (person_id, date)
);
create or replace function public.cl_daystarts_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    new.person_id := auth.uid();
    new.date := public.cl_today();
    new.started_at := now();
  end if;
  return new;
end $$;
drop trigger if exists cl_daystarts_guard on public.cl_daystarts;
create trigger cl_daystarts_guard before insert on public.cl_daystarts
  for each row execute function public.cl_daystarts_guard();

-- ---------------------------------------------------------------------
-- 6. Báo cáo ngày & tuần
-- ---------------------------------------------------------------------
create table if not exists public.cl_reports (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.cl_members (id) on delete cascade,
  date date not null,
  submitted_at timestamptz not null default now(),
  blockers text,
  plan text,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'returned')),
  manager_note text,
  reviewed_at timestamptz,
  unique (person_id, date)
);
create table if not exists public.cl_weekly (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.cl_members (id) on delete cascade,
  week date not null,
  highlights text,
  issues text,
  next_plan text,
  submitted_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'returned')),
  manager_note text,
  reviewed_at timestamptz,
  unique (person_id, week)
);
-- Nhân viên nộp/nộp lại: giờ nộp do máy chủ ghi, trạng thái về "chờ duyệt". Quản lý chỉ đổi phần duyệt.
create or replace function public.cl_report_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null then return new; end if;
  if public.cl_is_admin() and tg_op = 'UPDATE' and new.person_id <> auth.uid() then
    new.reviewed_at := now();
    return new;
  end if;
  new.person_id := auth.uid();
  new.submitted_at := now();
  new.status := 'submitted';
  new.manager_note := case when tg_op = 'UPDATE' then old.manager_note else null end;
  new.reviewed_at := null;
  return new;
end $$;
drop trigger if exists cl_reports_guard on public.cl_reports;
create trigger cl_reports_guard before insert or update on public.cl_reports
  for each row execute function public.cl_report_guard();
drop trigger if exists cl_weekly_guard on public.cl_weekly;
create trigger cl_weekly_guard before insert or update on public.cl_weekly
  for each row execute function public.cl_report_guard();

-- ---------------------------------------------------------------------
-- 7. Đồ riêng của từng người: thói quen, chat AI, đăng ký thông báo
-- ---------------------------------------------------------------------
create table if not exists public.cl_habits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.cl_members (id) on delete cascade default auth.uid(),
  title text not null,
  icon text,
  days int[] not null default '{0,1,2,3,4,5,6}',
  unit text,
  target numeric,
  created_at timestamptz not null default now()
);
create table if not exists public.cl_habit_logs (
  id uuid primary key default gen_random_uuid(),
  habit_id uuid not null references public.cl_habits (id) on delete cascade,
  owner_id uuid not null references public.cl_members (id) on delete cascade default auth.uid(),
  date date not null,
  value numeric not null default 1,
  unique (habit_id, date)
);
create table if not exists public.cl_chat (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.cl_members (id) on delete cascade default auth.uid(),
  role text not null check (role in ('me', 'bot')),
  text text not null,
  at timestamptz not null default now()
);
create index if not exists cl_chat_owner on public.cl_chat (owner_id, at desc);
create table if not exists public.cl_push_subs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.cl_members (id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  sub jsonb not null,
  created_at timestamptz not null default now()
);
-- Nhật ký đã gửi thông báo (chống gửi trùng)
create table if not exists public.cl_notify_log (
  key text primary key,
  sent_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. Sinh việc routine cho 1 ngày (gọi từ app khi mở + cron mỗi sáng)
-- ---------------------------------------------------------------------
create or replace function public.cl_generate_routines(p_date date default public.cl_today())
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.cl_tasks (owner_id, title, date, "time", end_time, source, routine_id, scope, grp, priority, kpi_id)
  select m.id, r.title, p_date, r."time", r.end_time,
         case when r.kind = 'meeting' then 'meeting' else 'routine' end,
         r.id, r.scope, r.grp, r.priority,
         (select k.id from public.cl_kpis k where k.key = r.kpi_key and k.owner_id = m.id and k.active limit 1)
  from public.cl_routines r
  join public.cl_members m on m.active and m.role <> 'bod'
    and (r.owner_id = m.id or (r.owner_id is null and (r.dept = 'all' or r.dept = m.dept)))
  where r.active
    and extract(dow from p_date) <> 0
    and (r.repeat = 'daily'
         or (r.repeat = 'weekdays' and extract(dow from p_date)::int = any (r.days))
         or (r.repeat = 'monthly' and extract(day from p_date)::int = r.month_day))
    and not exists (select 1 from public.cl_leaves l
                    where p_date between l."from" and l."to" and l.type in ('full', 'holiday')
                      and (l.person_id = m.id or l.type = 'holiday'))
  on conflict (routine_id, owner_id, date) where routine_id is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.cl_generate_routines(date) to authenticated;

-- Tạo mã liên kết Telegram cho chính mình
create or replace function public.cl_telegram_code() returns text
language plpgsql security definer set search_path = public as $$
declare c text := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
begin
  update public.cl_members set telegram_link_code = c where id = auth.uid();
  return c;
end $$;
grant execute on function public.cl_telegram_code() to authenticated;

-- ---------------------------------------------------------------------
-- 9. Phân quyền (Row Level Security)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cl_members','cl_settings','cl_routines','cl_kpis','cl_leaves','cl_tasks','cl_daystarts',
                           'cl_reports','cl_weekly','cl_habits','cl_habit_logs','cl_chat','cl_push_subs','cl_notify_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  -- Xoá policy cũ của các bảng cl_ để tạo lại
  for t in select format('drop policy if exists %I on public.%I', policyname, tablename) from pg_policies
           where schemaname = 'public' and tablename like 'cl\_%' loop
    execute t;
  end loop;
end $$;

-- Thành viên: ai cũng thấy danh sách thành viên (tên, phòng). Quản lý thêm/sửa; mỗi người sửa thông báo của mình.
create policy cl_members_select on public.cl_members for select to authenticated using (public.cl_is_member());
create policy cl_members_insert on public.cl_members for insert to authenticated with check (public.cl_is_admin());
create policy cl_members_update on public.cl_members for update to authenticated
  using (id = auth.uid() or public.cl_is_admin()) with check (id = auth.uid() or public.cl_is_admin());

-- Cấu hình chung: mọi thành viên đọc, quản lý sửa
create policy cl_settings_select on public.cl_settings for select to authenticated using (public.cl_is_member());
create policy cl_settings_update on public.cl_settings for update to authenticated using (public.cl_is_admin()) with check (public.cl_is_admin());
do $$
declare t text;
begin
  foreach t in array array['cl_routines','cl_kpis','cl_leaves'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.cl_is_member())', t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.cl_is_admin()) with check (public.cl_is_admin())', t || '_write', t);
  end loop;
end $$;
-- Routine riêng tư của quản lý: chỉ chính chủ thấy
drop policy if exists cl_routines_select on public.cl_routines;
create policy cl_routines_select on public.cl_routines for select to authenticated
  using (public.cl_is_member() and (scope = 'work' or owner_id = auth.uid()));

-- Công việc: việc RIÊNG chỉ chủ tài khoản thấy. Việc công ty: chủ + quản lý + BOD thấy.
create policy cl_tasks_select on public.cl_tasks for select to authenticated
  using (owner_id = auth.uid() or (scope = 'work' and public.cl_is_viewer()));
create policy cl_tasks_insert on public.cl_tasks for insert to authenticated
  with check (owner_id = auth.uid() or (public.cl_is_admin() and scope = 'work'));
create policy cl_tasks_update on public.cl_tasks for update to authenticated
  using (owner_id = auth.uid() or (public.cl_is_admin() and scope = 'work'))
  with check (owner_id = auth.uid() or (public.cl_is_admin() and scope = 'work'));
create policy cl_tasks_delete on public.cl_tasks for delete to authenticated
  using ((owner_id = auth.uid() and source in ('adhoc', 'plan')) or (public.cl_is_admin() and scope = 'work'));

-- Bắt đầu ngày: tự ghi của mình; quản lý/BOD xem; chỉ quản lý xoá (trường hợp bấm nhầm)
create policy cl_daystarts_select on public.cl_daystarts for select to authenticated
  using (person_id = auth.uid() or public.cl_is_viewer());
create policy cl_daystarts_insert on public.cl_daystarts for insert to authenticated with check (public.cl_is_member());
create policy cl_daystarts_delete on public.cl_daystarts for delete to authenticated using (public.cl_is_admin());

-- Báo cáo
do $$
declare t text;
begin
  foreach t in array array['cl_reports','cl_weekly'] loop
    execute format('create policy %I on public.%I for select to authenticated using (person_id = auth.uid() or public.cl_is_viewer())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.cl_is_member())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (person_id = auth.uid() or public.cl_is_admin()) with check (public.cl_is_member())', t || '_update', t);
  end loop;
end $$;

-- Đồ riêng: chỉ chính chủ
do $$
declare t text;
begin
  foreach t in array array['cl_habits','cl_habit_logs','cl_chat','cl_push_subs'] loop
    execute format('create policy %I on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid() and public.cl_is_member())', t || '_own', t);
  end loop;
end $$;
-- cl_notify_log: không policy nào → chỉ máy chủ (service role) đọc/ghi.

-- ---------------------------------------------------------------------
-- 10. Khởi tạo: Admin + routine mẫu (chỉ chạy khi chưa có)
-- ---------------------------------------------------------------------
insert into public.cl_members (id, email, full_name, role, notify_push, notify_telegram)
select p.id, p.email, coalesce(nullif(p.full_name, ''), 'Quản lý'), 'admin', true, true
from public.profiles p where lower(p.email) = 'hoangfairplaysports@gmail.com'
on conflict (id) do update set role = 'admin', active = true;

do $$
declare admin_id uuid := (select id from public.cl_members where role = 'admin' order by created_at limit 1);
begin
  if exists (select 1 from public.cl_routines) then return; end if;
  insert into public.cl_routines (title, dept, owner_id, repeat, days, month_day, "time", end_time, kind, priority, kpi_key) values
    ('Họp phòng ban',              'all',   null,     'weekdays', '{1}', null, '10:00', '11:30', 'meeting', 'high', null),
    ('Họp phòng ban',              'all',   null,     'weekdays', '{3}', null, '16:30', '17:30', 'meeting', 'high', null),
    ('Họp review tuần',            'all',   null,     'weekdays', '{5}', null, '15:00', '16:00', 'meeting', 'high', null),
    ('Check email',                null,    admin_id, 'daily',    '{}',  null, '09:00', null, 'task', 'mid',  null),
    ('Check tin nhắn MXH (Facebook, Zalo, LinkedIn)', null, admin_id, 'daily', '{}', null, '09:15', null, 'task', 'mid', null),
    ('Check CRM — lead mới & follow-up quá hạn', null, admin_id, 'daily', '{}', null, '09:30', null, 'task', 'high', null),
    ('Duyệt báo cáo ngày của team', null,   admin_id, 'weekdays', '{1,2,3,4,5}', null, '17:15', null, 'task', 'high', null),
    ('Đăng bài Facebook',          'mkt',   null,     'daily',    '{}',  null, '09:30', null, 'task', 'mid',  'fb'),
    ('Đăng bài LinkedIn',          'mkt',   null,     'weekdays', '{1,2,3,4,5}', null, '10:00', null, 'task', 'mid', 'li'),
    ('Đăng video TikTok',          'mkt',   null,     'daily',    '{}',  null, '14:00', null, 'task', 'mid',  'tt'),
    ('Duyệt tin tức website',      'mkt',   null,     'daily',    '{}',  null, '11:00', null, 'task', 'mid',  null),
    ('Check CRM & lead mới',       'sales', null,     'daily',    '{}',  null, '09:15', null, 'task', 'high', null),
    ('Gọi / nhắn follow-up khách', 'sales', null,     'daily',    '{}',  null, '10:00', null, 'task', 'high', 'fu'),
    ('Tìm khách hàng mới',         'sales', null,     'weekdays', '{1,2,3,4,5}', null, '14:00', null, 'task', 'mid', 'new'),
    ('Cập nhật CRM cuối ngày',     'sales', null,     'daily',    '{}',  null, '16:30', null, 'task', 'mid',  null);
  -- Bỏ các routine riêng của admin nếu chưa có admin
  delete from public.cl_routines where owner_id is null and dept is null;
end $$;
