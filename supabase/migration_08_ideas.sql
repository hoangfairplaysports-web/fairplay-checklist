-- =====================================================================
-- Gợi ý mỗi ngày (AI): mỗi sáng trợ lý đề xuất vài việc MỚI để phát triển
-- (kinh doanh, marketing, bản thân) dựa trên checklist, KPI và số liệu CRM.
-- Chỉ THÊM bảng / cột. Chạy lại nhiều lần an toàn.
-- =====================================================================

-- Ai được nhận gợi ý (quản lý bật/tắt cho từng người). Mặc định: chỉ Quản lý.
alter table public.cl_members add column if not exists ideas_on boolean not null default false;
update public.cl_members set ideas_on = true where role = 'admin' and ideas_on = false
  and not exists (select 1 from public.cl_members where ideas_on);

create table if not exists public.cl_ideas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.cl_members (id) on delete cascade,
  date date not null default public.cl_today(),
  area text not null default 'growth' check (area in ('sales', 'mkt', 'growth', 'ops')),
  title text not null,
  why text,
  steps text,
  effort text,
  status text not null default 'new' check (status in ('new', 'added', 'dismissed')),
  feedback smallint check (feedback in (-1, 1)),
  task_id uuid references public.cl_tasks (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cl_ideas_owner_date on public.cl_ideas (owner_id, date desc);

-- Chỉ chính chủ thấy và đánh dấu gợi ý của mình. Gợi ý do máy chủ (AI) tạo.
alter table public.cl_ideas enable row level security;
drop policy if exists cl_ideas_select on public.cl_ideas;
drop policy if exists cl_ideas_update on public.cl_ideas;
create policy cl_ideas_select on public.cl_ideas for select to authenticated using (owner_id = auth.uid());
create policy cl_ideas_update on public.cl_ideas for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Người dùng chỉ được đổi trạng thái / đánh giá, không sửa nội dung gợi ý
create or replace function public.cl_ideas_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then
    new.owner_id := old.owner_id; new.date := old.date; new.area := old.area; new.title := old.title;
    new.why := old.why; new.steps := old.steps; new.effort := old.effort; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists cl_ideas_guard on public.cl_ideas;
create trigger cl_ideas_guard before update on public.cl_ideas
  for each row execute function public.cl_ideas_guard();
