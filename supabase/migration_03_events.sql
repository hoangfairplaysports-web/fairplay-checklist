-- =====================================================================
-- Triển khai giải (dùng chung cho Fairplay CRM + Fairplay Checklist)
-- ev_events    : giải đã chốt/ký HĐ đang triển khai
-- ev_items     : hạng mục báo giá + phát sinh (kèm nhà cung cấp, giá nhập, trả NCC, nghiệm thu)
-- ev_payments  : các đợt khách thanh toán
-- ev_suppliers : danh bạ nhà cung cấp
-- ev_tasks     : checklist triển khai (Trước / Trong / Sau)
-- ev_files     : file báo giá, hợp đồng, nghiệm thu (Supabase Storage, bucket ev-files)
-- Phần TIỀN (items, payments, suppliers, files) chỉ Admin xem/sửa.
-- File chạy lại an toàn.
-- =====================================================================

-- Admin = admin CRM hoặc quản lý Checklist
create or replace function public.ev_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false) or coalesce(public.cl_role() = 'admin', false)
$$;
-- Thành viên được xem tiến độ giải: thành viên CRM hoặc Checklist
create or replace function public.ev_is_member() returns boolean
language sql stable as $$ select public.is_member() or public.cl_is_member() $$;

create table if not exists public.ev_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  customer_id uuid,                       -- khách hàng trong CRM (nếu có)
  sport text,
  venue text,
  event_date date,
  end_date date,
  headcount int,
  status text not null default 'preparing' check (status in ('preparing', 'running', 'done', 'cancelled')),
  pm_id uuid references public.cl_members (id) on delete set null,
  client_contact text,                    -- tên + SĐT đầu mối phía khách
  contract_signed_at date,
  contract_deadline date,                 -- hạn phải ký HĐ
  contract_note text,
  source_file text,                       -- tên file báo giá + sheet
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ev_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  contact text,
  phone text,
  bank text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.ev_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ev_events (id) on delete cascade,
  section text,                           -- I. TƯ VẤN…, II. VẬN HÀNH…
  grp text,                               -- nhóm con: Trước giải đấu, Thiết bị thi đấu…
  name text not null,
  detail text,
  qty numeric,
  unit text,
  unit_price numeric,
  days text,
  amount numeric,
  note text,
  is_option boolean not null default false,
  chosen boolean not null default true,   -- Option: khách đã chọn chưa
  is_extra boolean not null default false,-- phát sinh sau hợp đồng
  extra_by text,                          -- ai yêu cầu phát sinh
  extra_date date,
  supplier_id uuid references public.ev_suppliers (id) on delete set null,
  cost_amount numeric,                    -- giá nhập / phải trả NCC
  supplier_paid numeric not null default 0,
  supplier_due date,
  supplier_status text not null default 'unpaid' check (supplier_status in ('unpaid', 'partial', 'paid', 'none')),
  supplier_issue text,                    -- khó khăn chưa trả được
  accept_status text not null default 'pending' check (accept_status in ('pending', 'ok', 'issue')),
  accept_qty numeric,
  accept_note text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ev_items_event on public.ev_items (event_id, sort);

create table if not exists public.ev_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ev_events (id) on delete cascade,
  label text not null,
  percent numeric,
  amount numeric,
  due_date date,
  due_rule text,                          -- VD "D-3", "D+3 sau nghiệm thu"
  paid_amount numeric not null default 0,
  paid_at date,
  status text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid')),
  last_reminded date,
  note text,
  sort int not null default 0
);
create index if not exists ev_payments_event on public.ev_payments (event_id, sort);

create table if not exists public.ev_tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ev_events (id) on delete cascade,
  phase text not null default 'before' check (phase in ('before', 'during', 'after')),
  category text,
  title text not null,
  detail text,
  pic_id uuid references public.cl_members (id) on delete set null,
  pic_name text,                          -- người ngoài (đối tác/khách)
  sup_client text,
  sup_fp text,
  offset_days int,                        -- mốc D (âm = trước giải)
  due_date date,
  status text not null default 'todo' check (status in ('todo', 'doing', 'blocked', 'done')),
  note text,
  item_id uuid references public.ev_items (id) on delete set null,
  sort int not null default 0,
  done_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ev_tasks_event on public.ev_tasks (event_id, sort);
create index if not exists ev_tasks_pic on public.ev_tasks (pic_id) where status <> 'done';

create table if not exists public.ev_files (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ev_events (id) on delete cascade,
  kind text not null default 'other' check (kind in ('quote', 'contract', 'acceptance', 'other')),
  name text not null,
  path text not null,
  size int,
  uploaded_at timestamptz not null default now()
);

-- Thời điểm xong / cập nhật do máy chủ ghi; người phụ trách (không phải admin) chỉ sửa trạng thái + ghi chú
create or replace function public.ev_tasks_guard() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then new.done_at := now(); end if;
  if new.status <> 'done' then new.done_at := null; end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' and auth.uid() is not null and not public.ev_is_admin() then
    new.event_id := old.event_id; new.phase := old.phase; new.category := old.category; new.title := old.title;
    new.detail := old.detail; new.pic_id := old.pic_id; new.pic_name := old.pic_name; new.due_date := old.due_date;
    new.offset_days := old.offset_days; new.item_id := old.item_id; new.sort := old.sort;
  end if;
  return new;
end $$;
drop trigger if exists ev_tasks_guard on public.ev_tasks;
create trigger ev_tasks_guard before insert or update on public.ev_tasks
  for each row execute function public.ev_tasks_guard();

create or replace function public.ev_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists ev_events_touch on public.ev_events;
create trigger ev_events_touch before update on public.ev_events for each row execute function public.ev_touch();

-- ---------------------------------------------------------------------
-- Phân quyền
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ev_events','ev_items','ev_payments','ev_suppliers','ev_tasks','ev_files'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  for t in select format('drop policy if exists %I on public.%I', policyname, tablename) from pg_policies
           where schemaname = 'public' and tablename like 'ev\_%' loop
    execute t;
  end loop;
end $$;

-- Giải + checklist: mọi thành viên xem; Admin thêm/sửa/xoá; người phụ trách cập nhật việc của mình
create policy ev_events_select on public.ev_events for select to authenticated using (public.ev_is_member());
create policy ev_events_write on public.ev_events for all to authenticated using (public.ev_is_admin()) with check (public.ev_is_admin());
create policy ev_tasks_select on public.ev_tasks for select to authenticated using (public.ev_is_member());
create policy ev_tasks_admin on public.ev_tasks for all to authenticated using (public.ev_is_admin()) with check (public.ev_is_admin());
create policy ev_tasks_pic on public.ev_tasks for update to authenticated using (pic_id = auth.uid()) with check (pic_id = auth.uid());
-- Tiền & hồ sơ: chỉ Admin
do $$
declare t text;
begin
  foreach t in array array['ev_items','ev_payments','ev_suppliers','ev_files'] loop
    execute format('create policy %I on public.%I for all to authenticated using (public.ev_is_admin()) with check (public.ev_is_admin())', t || '_admin', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Kho file (private) — chỉ Admin
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('ev-files', 'ev-files', false, 20971520)
on conflict (id) do nothing;
drop policy if exists ev_files_admin on storage.objects;
create policy ev_files_admin on storage.objects for all to authenticated
  using (bucket_id = 'ev-files' and public.ev_is_admin())
  with check (bucket_id = 'ev-files' and public.ev_is_admin());
