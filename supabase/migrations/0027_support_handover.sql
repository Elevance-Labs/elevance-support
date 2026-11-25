-- ============================================================
-- 0027 — the support day hands over at a set time, in a set zone
--
-- A schedule says "Saad, Monday to Tuesday", and the team reads that as Saad
-- covering Tuesday night too. Until now the rota turned over at midnight UTC,
-- so a ticket arriving at 1:00 AM on Wednesday went to Wednesday's pair while Saad
-- was still the one on call.
--
-- Each project now says when its support day turns over: a time zone and a
-- hand-over time. The support day of a moment is its date in that zone, after
-- taking the hand-over time off it — so with Asia/Karachi and 12:00 PM:
--
--   Mon 11:59 AM PKT → Sunday's pair
--   Mon 12:00 PM PKT → Monday's pair
--   Wed  1:00 AM PKT → Tuesday's pair  (Saad, still)
--   Wed 12:00 PM PKT → Wednesday's pair
--
-- A schedule keeps its plain `date` range; only the reading of "which day is
-- it" changes. Two places read it, both here:
--
--   * stamp_issue_schedule() — which rota a new ticket lands on, by its
--     submitted date (back-dated tickets included);
--   * schedule_is_past()     — which schedules a manager may still change.
--
-- The defaults (UTC, midnight) are exactly the old behaviour, so nothing moves
-- until a project is configured.
--
-- Who sets it: an admin, or a manager on the project — the same people who run
-- the rota. Through set_support_handover(), because the projects table itself
-- stays admin-only to write.
--
-- Safe to re-run.
-- ============================================================

alter table public.projects
  add column if not exists support_time_zone text not null default 'UTC';
alter table public.projects
  add column if not exists support_handover time not null default '00:00';

comment on column public.projects.support_time_zone is
  'The IANA time zone the support rota is kept in (e.g. Asia/Karachi). With
   support_handover, decides which schedule day a moment belongs to.';
comment on column public.projects.support_handover is
  'When one support day hands over to the next, in support_time_zone. A
   schedule day D runs from D at this time to D+1 at this time.';

-- ---------- a zone the database knows ----------
-- An unknown zone would make `at time zone` raise inside the ticket insert
-- trigger — a customer's request failing to file over a typo — so it is
-- refused where it is written instead.
create or replace function public.is_time_zone(p text)
returns boolean language sql stable as $$
  select exists (select 1 from pg_timezone_names where name = p);
$$;

create or replace function public.verify_support_handover()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT'
     or new.support_time_zone is distinct from old.support_time_zone then
    if not public.is_time_zone(new.support_time_zone) then
      raise exception '"%" is not a time zone this database knows', new.support_time_zone
        using errcode = 'check_violation';
    end if;
  end if;
  -- Minutes are the finest a hand-over is set to.
  new.support_handover := date_trunc('minute', '2000-01-01'::date + new.support_handover)::time;
  return new;
end $$;

drop trigger if exists projects_verify_handover on public.projects;
create trigger projects_verify_handover before insert or update on public.projects
  for each row execute function public.verify_support_handover();

-- ---------- which support day a moment belongs to ----------
-- Falls back to the UTC date for a project that does not exist, so a caller
-- always gets a day.
create or replace function public.support_day(p_project uuid, p_at timestamptz default now())
returns date language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ((p_at at time zone p.support_time_zone)
             - (p.support_handover - time '00:00'))::date
     from public.projects p where p.id = p_project),
    (p_at at time zone 'UTC')::date
  );
$$;

comment on function public.support_day(uuid, timestamptz) is
  'The schedule day a moment falls in for a project: its date in the project''s
   support_time_zone, after taking support_handover off it.';

-- ---------- a new ticket is assigned by the rota it arrived in ----------
-- As in 0009, but by the project's support day rather than the UTC date.
create or replace function public.stamp_issue_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rota uuid[];
begin
  if coalesce(array_length(new.assignee_ids, 1), 0) > 0 then
    return new;
  end if;

  rota := public.scheduled_assignees(
    new.project_id,
    public.support_day(new.project_id, coalesce(new.submitted_date, now()))
  );

  if rota is null then
    return new;
  end if;

  -- Stale rota: somebody has moved department since it was written. Take the
  -- first name rather than refusing the ticket.
  if public.shared_department(rota) is not null then
    rota := rota[1:1];
  end if;

  new.assignee_ids := rota;
  return new;
end $$;

-- ---------- has this schedule already ended? ----------
-- By the project's support day, so a manager keeps a schedule through its last
-- night, not just to midnight UTC.
create or replace function public.schedule_is_past(p_project uuid, p_ends_on date)
returns boolean language sql stable as $$
  select p_ends_on < public.support_day(p_project);
$$;

comment on function public.schedule_is_past(uuid, date) is
  'Whether a schedule''s last day is behind the project''s current support day.
   Inclusive: one ending today is still current.';

drop policy if exists project_schedules_manager_update on public.project_schedules;
create policy project_schedules_manager_update on public.project_schedules
  for update to authenticated
  using (
    public.my_role() = 'manager'
    and public.is_project_member(project_id)
    and not public.schedule_is_past(project_id, ends_on)
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
    and not public.schedule_is_past(project_id, ends_on)
  );

drop function if exists public.schedule_is_past(date);

-- ---------- setting it ----------
-- The projects table stays admin-only to write; this is the one column pair a
-- manager on the project may change, because it is part of running the rota.
create or replace function public.set_support_handover(
  p_project uuid, p_time_zone text, p_handover time
)
returns public.projects language plpgsql security definer set search_path = public as $$
declare
  r public.projects;
begin
  if not (
    public.is_admin()
    or (public.my_role() = 'manager' and public.is_project_member(p_project))
  ) then
    raise exception 'Only an admin, or a manager on this project, can change when support hands over'
      using errcode = 'insufficient_privilege';
  end if;

  update public.projects
  set support_time_zone = p_time_zone, support_handover = p_handover
  where id = p_project
  returning * into r;

  if not found then
    raise exception 'No such project' using errcode = 'no_data_found';
  end if;
  return r;
end $$;

revoke all on function public.set_support_handover(uuid, text, time) from public, anon;
grant execute on function public.set_support_handover(uuid, text, time) to authenticated;
