-- =====================================================================
-- Báo cáo đội nhóm (AI Quản lý Đội nhóm): tổng hợp chuyên cần 7 ngày, báo cáo ngày,
-- việc quá hạn / đang vướng và KPI kỳ này của từng nhân viên.
-- Dùng cho tin nhắn 18:30 (cl-notify) và Văn phòng AI. Chỉ máy chủ được gọi.
-- Chạy lại nhiều lần an toàn.
-- =====================================================================
create or replace function public.cl_team_report() returns json
language sql stable security definer set search_path = public as $fn$
with s as (
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date as today,
         (now() at time zone 'Asia/Ho_Chi_Minh')::time as nowt,
         coalesce((data->>'late_after')::time, '09:00') as late_after,
         coalesce((data->>'very_late_after')::time, '09:30') as very_late,
         coalesce((data->>'report_deadline')::time, '17:00') as rep_deadline
  from cl_settings where id = 1
), p as (
  select s.*, date_trunc('week', s.today)::date as wk, date_trunc('month', s.today)::date as mo, date_trunc('quarter', s.today)::date as qt from s
), staff as (
  select m.id, m.full_name, m.dept, m.title from cl_members m where m.active and m.role = 'staff'
), days as (
  select st.id as pid, d::date as d
  from staff st, p, generate_series(p.today - 6, p.today, interval '1 day') d
  where extract(dow from d) <> 0
    and not exists (select 1 from cl_leaves l where (l.person_id = st.id or l.type = 'holiday') and l.type in ('full', 'holiday') and d::date between l."from" and l."to")
), att as (
  select dy.pid, dy.d, (ds.started_at at time zone 'Asia/Ho_Chi_Minh')::time as t,
         (select r.submitted_at at time zone 'Asia/Ho_Chi_Minh' from cl_reports r where r.person_id = dy.pid and r.date = dy.d) as rep
  from days dy left join cl_daystarts ds on ds.person_id = dy.pid and ds.date = dy.d
), kp as (
  select k.owner_id, k.title, k.type, k.target, k.period, k.crm_metric,
    case k.period when 'week' then p.wk when 'month' then p.mo else p.qt end as f
  from cl_kpis k, p where k.active
), kv as (
  select kp.*, case
    when crm_metric = 'new_companies' then (select count(*) from customers c where c.owner_id = kp.owner_id and (c.first_touch_at at time zone 'Asia/Ho_Chi_Minh')::date >= kp.f)
    when crm_metric = 'meetings' then (select count(*) from customers c where c.owner_id = kp.owner_id and (c.meeting_at at time zone 'Asia/Ho_Chi_Minh')::date >= kp.f)
    when crm_metric = 'touch_ontime_pct' then (select round(100.0 * count(*) filter (where t.done_at is not null and (t.done_at at time zone 'Asia/Ho_Chi_Minh')::date <= t.due_date) / nullif(count(*), 0))
        from prospect_touches t join customers c on c.id = t.customer_id, p
        where c.owner_id = kp.owner_id and not t.skipped and t.due_date >= kp.f and (t.due_date < p.today or t.done_at is not null))
    when type = 'bool' then (select case when k2.manual ? kp.f::text then (case when (k2.manual->>kp.f::text)::boolean then 1 else 0 end) end from cl_kpis k2 where k2.owner_id = kp.owner_id and k2.title = kp.title limit 1)
    when type = 'percent' then (select (k2.manual->>kp.f::text)::numeric from cl_kpis k2 where k2.owner_id = kp.owner_id and k2.title = kp.title limit 1)
    else (select coalesce(sum(coalesce(t.qty, 1)), 0) from cl_tasks t join cl_kpis k2 on k2.id = t.kpi_id
          where k2.owner_id = kp.owner_id and k2.title = kp.title and t.status = 'done' and (t.done_at at time zone 'Asia/Ho_Chi_Minh')::date >= kp.f)
         + coalesce((select (k2.manual->>kp.f::text)::numeric from cl_kpis k2 where k2.owner_id = kp.owner_id and k2.title = kp.title limit 1), 0)
  end as v
  from kp
)
select json_build_object(
  'today', (select today from p),
  'now', (select to_char(nowt, 'HH24:MI') from p),
  'week_from', (select today - 6 from p),
  'rules', (select json_build_object('late_after', to_char(late_after, 'HH24:MI'), 'very_late', to_char(very_late, 'HH24:MI'), 'report_deadline', to_char(rep_deadline, 'HH24:MI')) from p),
  'people', (select coalesce(json_agg(x order by x->>'dept', x->>'name'), '[]') from (
    select json_build_object(
      'name', st.full_name, 'dept', st.dept, 'title', st.title,
      'on_leave_today', not exists (select 1 from days dy, p where dy.pid = st.id and dy.d = p.today),
      'start_today', (select to_char(a.t, 'HH24:MI') from att a, p where a.pid = st.id and a.d = p.today),
      'report_today', (select to_char(a.rep, 'HH24:MI') from att a, p where a.pid = st.id and a.d = p.today),
      'week_started', (select count(*) from att a where a.pid = st.id and a.t is not null),
      'week_days', (select count(*) from att a, p where a.pid = st.id and (a.d < p.today or a.t is not null)),
      'week_late', (select coalesce(json_agg(json_build_object('d', a.d, 't', to_char(a.t, 'HH24:MI')) order by a.d), '[]') from att a, p where a.pid = st.id and date_trunc('minute', a.t) > p.late_after),
      'week_very_late', (select count(*) from att a, p where a.pid = st.id and date_trunc('minute', a.t) > p.very_late),
      'week_no_start', (select coalesce(json_agg(a.d order by a.d), '[]') from att a, p where a.pid = st.id and a.t is null and a.d < p.today and extract(dow from a.d) <> 6),
      'week_rep_due', (select count(*) from att a, p where a.pid = st.id and extract(dow from a.d) between 1 and 5 and a.d < p.today),
      'week_rep_missing', (select coalesce(json_agg(a.d order by a.d), '[]') from att a, p where a.pid = st.id and extract(dow from a.d) between 1 and 5 and a.d < p.today and a.rep is null),
      'week_rep_late', (select coalesce(json_agg(json_build_object('d', a.d, 't', to_char(a.rep, 'HH24:MI')) order by a.d), '[]') from att a, p where a.pid = st.id and extract(dow from a.d) between 1 and 5 and a.d < p.today and a.rep::time > p.rep_deadline),
      'tasks_today', (select json_build_object('done', count(*) filter (where t.status = 'done'), 'all', count(*)) from cl_tasks t, p where t.owner_id = st.id and t.date = p.today and t.scope = 'work' and not t.hidden),
      'overdue', (select count(*) from cl_tasks t, p where t.owner_id = st.id and t.scope = 'work' and not t.hidden and t.status <> 'done' and t.due_date < p.today),
      'blocked', (select count(*) from cl_tasks t where t.owner_id = st.id and t.scope = 'work' and not t.hidden and t.status = 'blocked'),
      'kpis', (select coalesce(json_agg(json_build_object('t', kv.title, 'type', kv.type, 'target', kv.target, 'period', kv.period, 'from', kv.f, 'v', kv.v) order by kv.period, kv.title), '[]') from kv where kv.owner_id = st.id)
    ) as x
    from staff st
  ) q)
)

$fn$;

revoke all on function public.cl_team_report() from public, anon, authenticated;
grant execute on function public.cl_team_report() to service_role;
