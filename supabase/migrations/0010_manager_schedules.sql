-- ============================================================
-- 0010 — managers may manage the support rota
--
-- Who may write a schedule. Nothing about how a schedule behaves changes here:
-- the overlap rule, the department rule and the insert trigger that assigns a
-- ticket from the rota are untouched.
--
--   admin    — create, update and delete any schedule
--   manager  — create any schedule; update and delete only current and upcoming
--              ones (last day today or later), in projects they belong to
--   member   — none
--
-- "Today" is the UTC day, the same day the rota trigger assigns a ticket by.
--
-- RLS refuses an update or a delete by matching no rows rather than by raising,
-- so the UI withholds the controls and reports a write that came back empty.
--
-- Safe to re-run.
-- ============================================================

-- ---------- has this schedule already ended? ----------
create or replace function public.schedule_is_past(p_ends_on date)
returns boolean language sql stable as $$
  select p_ends_on < (now() at time zone 'UTC')::date;
$$;

comment on function public.schedule_is_past(date) is
  'Whether a schedule''s last day is behind us, in UTC. Inclusive: one ending
   today is still current.';

-- ---------- admins: everything ----------
drop policy if exists project_schedules_admin_write on public.project_schedules;
create policy project_schedules_admin_write on public.project_schedules
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- managers ----------
-- Scoped to projects they belong to, the same membership that lets them read a
-- project's rota at all. Admins are exempt from membership everywhere.
--
-- Split per command because the time rule applies to the row already there —
-- which existing schedules a manager may touch — not to what they write.
drop policy if exists project_schedules_manager_insert on public.project_schedules;
create policy project_schedules_manager_insert on public.project_schedules
  for insert to authenticated
  with check (
    public.my_role() = 'manager'
    and public.is_project_member(project_id)
  );

drop policy if exists project_schedules_manager_update on public.project_schedules;
create policy project_schedules_manager_update on public.project_schedules
  for update to authenticated
  using (
    public.my_role() = 'manager'
    and public.is_project_member(project_id)
    and not public.schedule_is_past(ends_on)
  )
  with check (
    public.my_role() = 'manager'
    and public.is_project_member(project_id)
  );

drop policy if exists project_schedules_manager_delete on public.project_schedules;
create policy project_schedules_manager_delete on public.project_schedules
  for delete to authenticated
  using (
    public.my_role() = 'manager'
    and public.is_project_member(project_id)
    and not public.schedule_is_past(ends_on)
  );
