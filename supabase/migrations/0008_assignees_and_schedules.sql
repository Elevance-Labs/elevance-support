-- ============================================================
-- 0008 — two people on a ticket, and the rota that puts them there
--
-- Three changes, one idea: who is working a ticket stops being a single field
-- somebody remembers to fill in, and becomes a set the project decides.
--
--   1. A ticket carries up to **two** assignees (`issues.assignee_ids`) instead
--      of one (`issues.assignee_id`). Two is the cap because support is worked
--      in pairs here — a primary and a second pair of eyes — and a list with no
--      ceiling is a list nobody owns.
--
--   2. A project keeps a **schedule**: a date range and the one or two people on
--      support for it. Ranges within a project may not overlap, so "who is on
--      for this day" always has exactly one answer — that is an exclusion
--      constraint, not a convention.
--
--   3. A ticket that arrives inside a schedule is assigned by it. The trigger
--      reads the ticket's `submitted_date`, so a request logged by hand against
--      last Tuesday lands on whoever was on last Tuesday, not on today's pair.
--
-- And two rules on top, both here rather than only in the UI:
--
--   * Once a ticket has anyone on it, only an admin or a manager may change
--      who. Picking up an unowned ticket is ordinary work; taking one off a
--      colleague, or off yourself, is a scheduling decision.
--   * A ticket cannot leave a `new` status with nobody on it. Same shape as the
--      severity gate: triage says how bad it is, this says who has it.
--
-- Existing tickets keep their assignee — it is copied into the new column
-- before the old one goes — and the ones that had nobody stay that way until
-- someone moves them.
--
-- Safe to re-run.
-- ============================================================

-- `daterange ... with &&` in an exclusion constraint needs btree_gist to put
-- the plain `project_id = project_id` half of it in the same index.
create extension if not exists btree_gist;

-- ============================================================
-- The shape of an assignee set
-- ============================================================

-- One definition of "a valid set of assignees", used by the check constraint on
-- both tables and by the triggers below: at most two, no nulls, nobody twice.
-- `min_size` is what separates the two callers — a ticket may have nobody on
-- it, a schedule that names nobody is not a schedule.
create or replace function public.assignee_set_ok(ids uuid[], min_size int default 0)
returns boolean language sql immutable as $$
  select ids is not null
     and coalesce(array_length(ids, 1), 0) between min_size and 2
     and array_position(ids, null) is null
     and coalesce(array_length(ids, 1), 0) = (select count(distinct x) from unnest(ids) x);
$$;

comment on function public.assignee_set_ok(uuid[], int) is
  'Whether an assignee array is one this app will store: at most two people, no
   nulls, no duplicates. `min_size` is 1 for a schedule, 0 for a ticket.';

-- ============================================================
-- issues.assignee_ids
-- ============================================================

alter table public.issues add column if not exists assignee_ids uuid[] not null default '{}';

-- Carry the single assignee over before the column that held it is dropped.
-- Guarded on the column still existing so a second run is a no-op rather than
-- an error about a column that has already gone.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'issues' and column_name = 'assignee_id'
  ) then
    execute $mig$
      update public.issues
      set assignee_ids = array[assignee_id]
      where assignee_id is not null
        and coalesce(array_length(assignee_ids, 1), 0) = 0
    $mig$;
  end if;
end $$;

alter table public.issues drop constraint if exists issues_assignees_valid;
alter table public.issues add constraint issues_assignees_valid
  check (public.assignee_set_ok(assignee_ids, 0));

comment on column public.issues.assignee_ids is
  'Who is working this ticket — nobody, one person or two, in the order they
   were picked. An array rather than two columns because "who is on it" is one
   question; the cap of two is a check constraint, not a column count. Replaces
   the single `assignee_id`, which was dropped in this migration.';

drop index if exists public.issues_assignee_idx;
create index if not exists issues_assignees_idx on public.issues using gin (assignee_ids);

alter table public.issues drop column if exists assignee_id;

-- An array cannot carry a foreign key, so the `on delete set null` the old
-- column had is a trigger now: a deleted account leaves the tickets it was on,
-- rather than leaving an id that resolves to nobody.
create or replace function public.prune_deleted_assignee()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.issues
  set assignee_ids = array_remove(assignee_ids, old.id)
  where assignee_ids @> array[old.id];

  -- A schedule must name somebody, so one left empty goes with the account.
  delete from public.project_schedules
  where assignee_ids <@ array[old.id];

  update public.project_schedules
  set assignee_ids = array_remove(assignee_ids, old.id)
  where assignee_ids @> array[old.id];

  return old;
end $$;

-- ============================================================
-- project_schedules — who is on support, and when
-- ============================================================
create table if not exists public.project_schedules (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  -- Inclusive on both ends: a one-day rota is starts_on = ends_on.
  starts_on    date not null,
  ends_on      date not null,
  -- The one or two people on support for that range.
  assignee_ids uuid[] not null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint project_schedules_range check (ends_on >= starts_on),
  constraint project_schedules_assignees check (public.assignee_set_ok(assignee_ids, 1))
);

create index if not exists project_schedules_project_idx
  on public.project_schedules(project_id, starts_on desc);

-- Two schedules covering the same day in the same project would make "who is on
-- for this ticket" a question with two answers, and the trigger below would
-- quietly pick one. Refused outright instead.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_schedules_no_overlap'
  ) then
    alter table public.project_schedules add constraint project_schedules_no_overlap
      exclude using gist (
        project_id with =,
        daterange(starts_on, ends_on, '[]') with &&
      );
  end if;
end $$;

drop trigger if exists project_schedules_touch on public.project_schedules;
create trigger project_schedules_touch before update on public.project_schedules
  for each row execute function public.touch_updated_at();

-- The account trigger can only be created once the table it writes to exists.
drop trigger if exists profiles_prune_assignments on public.profiles;
create trigger profiles_prune_assignments after delete on public.profiles
  for each row execute function public.prune_deleted_assignee();

-- ---------- who was on, for a given day ----------
create or replace function public.scheduled_assignees(p_project uuid, p_on date)
returns uuid[] language sql stable security definer set search_path = public as $$
  select s.assignee_ids
  from public.project_schedules s
  where s.project_id = p_project
    and daterange(s.starts_on, s.ends_on, '[]') @> p_on
  limit 1;
$$;

comment on function public.scheduled_assignees(uuid, date) is
  'The pair on support in this project on this day, or null. At most one row can
   match — project_schedules_no_overlap is what makes the `limit 1` honest.';

-- ============================================================
-- A new ticket is assigned by the rota it arrived in
-- ============================================================
-- Reads `submitted_date`, not now(): a request logged by hand against last
-- Tuesday belongs to whoever was on last Tuesday. Only ever fills an empty set,
-- so a ticket created with someone already on it keeps them.
--
-- The date is taken in UTC, which is what the database stores and what a `date`
-- column means here — a rota boundary is a day, and the day has to be the same
-- day for everyone reading the schedule.
--
-- Named to sort after `issues_stamp_origin` among the before-insert triggers
-- (they fire in alphabetical order), because that is what pins an anonymous
-- submission's date to now, and before `issues_verify_assignees`, which is the
-- rule this may be what satisfies.
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
    (coalesce(new.submitted_date, now()) at time zone 'UTC')::date
  );

  if rota is not null then
    new.assignee_ids := rota;
  end if;
  return new;
end $$;

drop trigger if exists issues_stamp_schedule on public.issues;
create trigger issues_stamp_schedule before insert on public.issues
  for each row execute function public.stamp_issue_schedule();

-- ============================================================
-- No owner, no progress
-- ============================================================
-- A ticket cannot leave a `new` status with nobody on it — including into a
-- closed one: answering or rejecting a request is work somebody did, and the
-- ticket should say who.
--
-- Only checks when the status or the assignees actually moved, so a ticket that
-- predates the rule stays editable in every other way until someone tries to
-- change where it stands.
create or replace function public.enforce_assignee_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t text;
begin
  if tg_op = 'UPDATE'
     and new.status       is not distinct from old.status
     and new.assignee_ids is not distinct from old.assignee_ids then
    return new;
  end if;

  t := public.status_type_of(new.status);
  if t is not null and t <> 'new'
     and coalesce(array_length(new.assignee_ids, 1), 0) = 0 then
    -- Two ways to break the same rule: moving an unowned ticket on, or taking
    -- the last person off one that has already moved.
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      raise exception
        'This ticket is in % and must keep an assignee — only a New ticket may have nobody on it',
        new.status
        using errcode = 'check_violation';
    end if;
    raise exception
      'Assign someone before moving this ticket to % — only a New ticket may have nobody on it',
      new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists issues_verify_assignees on public.issues;
create trigger issues_verify_assignees before insert or update on public.issues
  for each row execute function public.enforce_assignee_gate();

-- ============================================================
-- Who may change who is on a ticket
-- ============================================================
-- Folded into the rules trigger beside the other "what may still change"
-- questions. Picking up a ticket nobody holds is ordinary work, so anyone
-- signed in may. Changing a set that already names somebody is a scheduling
-- decision — taking work off a colleague, or handing yours away — so that is
-- an admin or a manager.
create or replace function public.enforce_issue_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_type   text;
  new_type   text;
  eff_type   text;
  actor_role text;
begin
  old_type := public.status_type_of(old.status);
  new_type := public.status_type_of(new.status);
  eff_type := public.effective_status_type(old.id, old.status);
  actor_role := public.my_role();

  if new.status is distinct from old.status
     and old_type is not null and new_type is not null then

    if new_type = 'paused' then
      -- A closed ticket is finished; there is nothing left to pause.
      if eff_type = 'closed' then
        raise exception 'A closed ticket cannot be paused'
          using errcode = 'check_violation';
      end if;
    elsif public.status_rank(new_type) < public.status_rank(eff_type) then
      raise exception
        'Cannot move a ticket from % (%) back to % (%)',
        old.status, eff_type, new.status, new_type
        using errcode = 'check_violation';
    end if;
  end if;

  -- Severity is the team's own reading of the ticket, so it takes a team
  -- member to set it. Anyone signed in may: severity gates starting work, and
  -- members are who start work.
  if new.severity is distinct from old.severity and actor_role is null then
    raise exception 'Only a signed-in team member can set a ticket''s severity'
      using errcode = 'check_violation';
  end if;

  -- Who is on the ticket. Taking an unowned one is work; reassigning an owned
  -- one is scheduling.
  if new.assignee_ids is distinct from old.assignee_ids then
    if actor_role is null then
      raise exception 'Only a signed-in team member can assign a ticket'
        using errcode = 'check_violation';
    end if;
    if coalesce(array_length(old.assignee_ids, 1), 0) > 0
       and actor_role not in ('admin', 'manager') then
      raise exception
        'This ticket is already assigned — only an admin or a manager can change who is on it'
        using errcode = 'check_violation';
    end if;
  end if;

  -- The submitted snapshot is history. Nobody edits it, including an admin.
  if new.submitted_type     is distinct from old.submitted_type
  or new.submitted_product  is distinct from old.submitted_product
  or new.submitted_area     is distinct from old.submitted_area
  or new.submitted_priority is distinct from old.submitted_priority then
    raise exception
      'The submitted classification is a record of the request and cannot be changed'
      using errcode = 'check_violation';
  end if;

  -- Type and priority are the request's own account of itself. The team
  -- records its reading of the ticket in severity, and where it belongs in
  -- product and area; neither is a reason to overwrite what was asked for.
  if new.type is distinct from old.type then
    raise exception 'A ticket''s type is set when it is submitted and cannot be changed'
      using errcode = 'check_violation';
  end if;
  if new.priority is distinct from old.priority then
    raise exception 'Priority is the requester''s own ranking and cannot be changed'
      using errcode = 'check_violation';
  end if;

  -- Product and area are where the ticket is filed, which is a judgement that
  -- improves as the ticket is understood. Anyone signed in may re-file one, at
  -- any point in its life — the submitted values above are what makes that safe.
  if (new.product is distinct from old.product
   or new.area    is distinct from old.area)
     and actor_role is null then
    raise exception 'Only a signed-in team member can re-file a ticket'
      using errcode = 'check_violation';
  end if;

  -- Pause clock: bank the elapsed pause on the way out, start it on the way in.
  if new_type = 'paused' and old_type is distinct from 'paused' then
    new.paused_since := now();
  elsif old_type = 'paused' and new_type is distinct from 'paused' then
    new.paused_ms := coalesce(old.paused_ms, 0)
      + greatest(0, (extract(epoch from (now() - coalesce(old.paused_since, now()))) * 1000)::bigint);
    new.paused_since := null;
  end if;

  -- The clock stops for good when the ticket reaches a closed status.
  if new_type = 'closed' and old_type is distinct from 'closed' then
    new.closed_at := now();
  elsif new_type is distinct from 'closed' then
    new.closed_at := null;
  end if;

  return new;
end $$;

drop trigger if exists issues_enforce_rules on public.issues;
create trigger issues_enforce_rules before update on public.issues
  for each row execute function public.enforce_issue_rules();

-- ============================================================
-- Row level security
-- ============================================================
-- Members of a project read its rota: it is who to expect a ticket from, and
-- the ticket detail explains an assignment by it. Only admins write one —
-- a schedule is project configuration, and the Projects page it lives on is
-- admin-only. The insert trigger above reads it as `security definer`, so an
-- anonymous submission is still assigned by a rota it cannot see.
alter table public.project_schedules enable row level security;

drop policy if exists project_schedules_read on public.project_schedules;
create policy project_schedules_read on public.project_schedules
  for select to authenticated using (public.is_project_member(project_id));

drop policy if exists project_schedules_admin_write on public.project_schedules;
create policy project_schedules_admin_write on public.project_schedules
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
