-- Nhân viên chỉ xem thông tin giải KHÔNG kèm số tiền (qua view); bảng gốc chỉ Admin
drop view if exists public.ev_events_public;
create view public.ev_events_public as
  select id, name, client_name, customer_id, sport, venue, event_date, end_date, headcount, status, pm_id, client_contact,
         contract_signed_at, contract_deadline, accepted_at, notes, created_at, updated_at
  from public.ev_events
  where public.ev_is_member();
revoke all on public.ev_events_public from anon;
grant select on public.ev_events_public to authenticated;
drop policy if exists ev_events_select on public.ev_events;
create policy ev_events_select on public.ev_events for select to authenticated using (public.ev_is_admin());
