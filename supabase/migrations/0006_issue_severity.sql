-- ============================================================
-- 0006 — severity: how hard the team commits to a ticket
--
-- Priority says how the *requester* ranks it. Severity is the team's own
-- judgement of what the ticket costs the customer, and — unlike priority — it
-- carries a promise: each severity states the behaviour it commits the team to
-- ("work starts immediately and continues until service is restored"). Staff
-- read that sentence while choosing, so it lives on the list item itself rather
-- than in a runbook nobody opens.
--
-- Two rules, both enforced here rather than only in the UI:
--
--   1. Severity is an internal judgement. The public embed form submits
--      anonymously, so an anonymous insert never carries one — whatever it
--      sends is dropped — and only a signed-in team member may change it.
--
--   2. A ticket cannot start or pause without one. Moving to a status of type
--      `in_progress` or `paused` is refused while severity is empty, on insert
--      as well as update, so triage has to happen before work does. `closed`
--      is deliberately not gated: a ticket can always be rejected or answered
--      outright without being triaged first.
--
-- Existing tickets keep a null severity and are left alone until someone moves
-- them: the gate fires on a change, never on an unrelated update to a row that
-- was already in flight when this shipped.
--
-- Safe to re-run.
-- ============================================================

-- ---------- the list gains a type, and a column only it uses ----------
alter table public.list_items drop constraint if exists list_items_list_type_check;
alter table public.list_items add constraint list_items_list_type_check
  check (list_type in ('type','product','area','priority','severity','status','labels','source'));

alter table public.list_items add column if not exists behavior text;

comment on column public.list_items.behavior is
  'What this severity commits the team to, in one sentence. Severity rows only —
   shown beside the name in the picker, so the promise is read at the moment it
   is made. Every other list type leaves it null.';

-- A severity that does not say what it means is just a second priority list.
alter table public.list_items drop constraint if exists list_items_severity_needs_behavior;
alter table public.list_items add constraint list_items_severity_needs_behavior
  check (list_type <> 'severity' or nullif(btrim(behavior), '') is not null);

insert into public.list_items (list_type, name, color, behavior, sort_order) values
  ('severity','Critical', '#b71c1c',
   'Service is down or unusable. Work starts immediately and continues until it is restored.', 1),
  ('severity','High',     '#e64a19',
   'A core workflow is broken with no practical workaround. Picked up the same working day.', 2),
  ('severity','Moderate', '#f9a825',
   'Something is wrong but there is a workaround. Scheduled into the current queue.', 3),
  ('severity','Low',      '#546e7a',
   'Cosmetic or an inconvenience. Batched into planned work; nothing else is interrupted.', 4)
on conflict (list_type, name) do nothing;

-- ---------- the column ----------
alter table public.issues add column if not exists severity text;

comment on column public.issues.severity is
  'The team''s severity judgement — a name from the `severity` list. Null until
   an internal user assigns one, which must happen before the ticket can move to
   an In Progress or Paused status. Never set by a public submission, and never
   sent to the public ticket view.';

-- ---------- a public submission cannot claim one ----------
-- Same trigger that reserves `Form` and pins the submission date: everything an
-- anonymous insert is not allowed to decide for itself lives here.
create or replace function public.stamp_issue_origin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- The public form, or the service role acting for it.
    new.source         := 'Form';
    new.submitted_date := now();
    -- Severity is the team's judgement, not the requester's. Dropped rather
    -- than rejected: a customer who guesses at a query param should still get
    -- their request filed.
    new.severity       := null;
  else
    if new.source = 'Form' then
      raise exception '`Form` is reserved for requests submitted through the public form';
    end if;
    -- A ticket cannot have been submitted after it was logged.
    if new.submitted_date is null or new.submitted_date > now() then
      new.submitted_date := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists issues_stamp_origin on public.issues;
create trigger issues_stamp_origin before insert on public.issues
  for each row execute function public.stamp_issue_origin();

-- ---------- no severity, no work ----------
-- Runs on insert and on update, but only when the status or the severity
-- actually moved: a ticket that predates this rule keeps being editable in
-- every other way until someone tries to change where it stands.
create or replace function public.enforce_severity_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t text;
begin
  if tg_op = 'UPDATE'
     and new.status   is not distinct from old.status
     and new.severity is not distinct from old.severity then
    return new;
  end if;

  t := public.status_type_of(new.status);
  if t in ('in_progress', 'paused')
     and nullif(btrim(coalesce(new.severity, '')), '') is null then
    -- Two ways to break the same rule: moving an untriaged ticket into a gated
    -- status, or taking the severity back off one already there.
    if tg_op = 'UPDATE' and new.status is not distinct from old.status then
      raise exception
        'This ticket is in % and must keep a severity — % statuses need one',
        new.status, t
        using errcode = 'check_violation';
    end if;
    raise exception
      'Assign a severity before moving this ticket to % — % statuses need one',
      new.status, t
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Named to sort last among the before-row triggers on `issues`, so it judges the
-- status the other triggers settled on: the default status a new ticket is given
-- and the severity `stamp_issue_origin` may just have dropped.
drop trigger if exists issues_verify_severity on public.issues;
create trigger issues_verify_severity before insert or update on public.issues
  for each row execute function public.enforce_severity_gate();

-- ---------- only an internal user assigns one ----------
-- Folded into the existing rules trigger, beside the request-field rule it is a
-- sibling of. Updates only: inserts are covered by stamp_issue_origin() above.
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

  -- Request fields are only editable by an admin or manager, and only while
  -- the ticket is still in a "new" status. They follow the effective type, so
  -- pausing a new ticket does not quietly lock them.
  if (new.type    is distinct from old.type
   or new.product is distinct from old.product
   or new.area    is distinct from old.area) then
    if eff_type is distinct from 'new' then
      raise exception
        'Request fields can only be changed while the ticket is in a New status'
        using errcode = 'check_violation';
    end if;
    if actor_role is null or actor_role not in ('admin','manager') then
      raise exception
        'Only an admin or manager can change the request fields'
        using errcode = 'check_violation';
    end if;
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
