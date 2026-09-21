-- ============================================================
-- 0009 — departments, and the pair rule they make possible
--
-- Every account belongs to one of five departments. They are a fixed list, not
-- a configuration one: unlike types or severities, these are the shape of the
-- organisation rather than vocabulary the team tunes — so they live in a check
-- constraint here and a constant in `src/lib/users.js`, and adding a sixth is a
-- migration rather than an evening on the Configuration page.
--
-- What the department is *for*: **a ticket's two assignees must come from two
-- different departments.** A pair is meant to be two readings of the same
-- problem — engineering and quality, support and product — so two people from
-- one department is not a pair, it is the same reading twice. One assignee is
-- always fine; the rule only has anything to say about a second.
--
-- The same rule applies to a support schedule, because a schedule is where most
-- pairs actually come from. A rota that named two engineers would mint tickets
-- that break the ticket rule, so it is refused at the source.
--
-- Existing accounts are backfilled to **Support** — the column default, so the
-- ALTER fills them in without a second pass. That is a placeholder, not a
-- finding: it makes the rule enforceable from day one, and an admin corrects it
-- on the Users page. Accounts created straight from the Supabase dashboard get
-- the same default for the same reason.
--
-- Safe to re-run.
-- ============================================================

-- ---------- the column ----------
alter table public.profiles add column if not exists department text;

-- Backfill before the constraint, so a row that predates this cannot fail it.
update public.profiles set department = 'Support' where department is null;

alter table public.profiles alter column department set default 'Support';
alter table public.profiles alter column department set not null;

alter table public.profiles drop constraint if exists profiles_department_check;
alter table public.profiles add constraint profiles_department_check
  check (department in ('Product','Design','Support','Engineering','Quality'));

comment on column public.profiles.department is
  'Which department this person works in — one of Product, Design, Support,
   Engineering, Quality. A fixed list, not a configuration one. Two assignees on
   a ticket must come from two different departments, which is the whole reason
   this column exists. Defaults to Support so an account created outside the app
   is still assignable; an admin corrects it on the Users page.';

-- ---------- a person's department, for the triggers below ----------
create or replace function public.department_of(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select department from public.profiles where id = p_user;
$$;

-- ---------- one per department ----------
-- Returns the department two people share, or null when they are a valid pair.
-- A set of one, or of none, can never clash. Written to take the array rather
-- than a row so the `issues` and `project_schedules` triggers can share it.
create or replace function public.shared_department(ids uuid[])
returns text language plpgsql stable security definer set search_path = public as $$
declare
  dupe text;
begin
  if coalesce(array_length(ids, 1), 0) < 2 then
    return null;
  end if;

  select p.department into dupe
  from unnest(ids) as u(id)
  join public.profiles p on p.id = u.id
  group by p.department
  having count(*) > 1
  limit 1;

  return dupe;
end $$;

comment on function public.shared_department(uuid[]) is
  'The department more than one of these people belong to, or null. Null is the
   answer for a set of one — the pair rule only has something to say about two.';

-- ---------- on a ticket ----------
-- Its own trigger rather than a clause in the assignee gate: that one fires
-- when the status moves too, and re-judging an untouched set would block a
-- status change on a ticket assigned before this rule existed. This one fires
-- only when somebody actually writes the assignees, so a pair from before is
-- left alone until the next person to touch it has to fix it.
--
-- Sorts after `issues_stamp_schedule`, so it judges the set the rota settled on.
create or replace function public.enforce_assignee_departments()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  dupe text;
begin
  if tg_op = 'UPDATE' and new.assignee_ids is not distinct from old.assignee_ids then
    return new;
  end if;

  dupe := public.shared_department(new.assignee_ids);
  if dupe is not null then
    raise exception
      'Both assignees are in %  — a ticket''s two assignees must come from different departments',
      dupe
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists issues_verify_departments on public.issues;
create trigger issues_verify_departments before insert or update on public.issues
  for each row execute function public.enforce_assignee_departments();

-- ---------- on a schedule ----------
-- A rota is where most pairs come from, so a bad one would mint bad tickets.
-- Refused at the source instead.
create or replace function public.enforce_schedule_departments()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  dupe text;
begin
  dupe := public.shared_department(new.assignee_ids);
  if dupe is not null then
    raise exception
      'Both people on this schedule are in % — a rota pairs two departments, not two colleagues',
      dupe
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists project_schedules_verify_departments on public.project_schedules;
create trigger project_schedules_verify_departments
  before insert or update on public.project_schedules
  for each row execute function public.enforce_schedule_departments();

-- ---------- a rota that has gone stale ----------
-- A schedule is checked when it is written, but somebody can move department
-- afterwards and leave a valid rota naming two colleagues. The alternative to
-- handling that here is an insert that raises — which would mean a customer's
-- request failing to file because of an HR change, so the rota gives way
-- instead: the first name is applied and the second is left off.
--
-- The Projects page flags a schedule in that state, which is the thing to fix.
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

drop trigger if exists issues_stamp_schedule on public.issues;
create trigger issues_stamp_schedule before insert on public.issues
  for each row execute function public.stamp_issue_schedule();

-- ---------- nobody promotes themselves into another department ----------
-- Folded into the trigger that already pins role, is_active and email on a
-- self-update. Department decides who you can be paired with, which makes it
-- the team's fact about you rather than yours.
create or replace function public.profiles_freeze_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and not public.is_admin() then
    new.role       := old.role;
    new.is_active  := old.is_active;
    new.email      := old.email;
    new.department := old.department;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_freeze_privileged on public.profiles;
create trigger profiles_freeze_privileged
  before update on public.profiles
  for each row execute function public.profiles_freeze_privileged_fields();
