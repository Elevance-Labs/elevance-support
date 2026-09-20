-- ============================================================
-- 0007 — what was submitted vs. what the team made of it
--
-- Two halves of one idea: a ticket now keeps the classification it *arrived*
-- with, separately from the one the team works it under.
--
--   1. `submitted_type` / `submitted_product` / `submitted_area` /
--      `submitted_priority` are stamped once, at insert, from whatever the
--      request carried, and then never change. They are the requester's own
--      words about their problem, so an edit afterwards would be rewriting
--      history — the question "how often is the request filed as one thing and
--      worked as another" only has an answer while both are on the row.
--
--   2. `type` and `priority` are now frozen outright. Type sets nothing the
--      team steers any more (the SLA moved to severity, below) and priority is
--      the requester's ranking, not ours — neither is the team's to rewrite.
--      `product` and `area` stay editable, by anyone signed in and at any point
--      in the ticket's life: they are where the ticket is filed, and filing is
--      corrected as often as it is understood. The old rule — admin/manager
--      only, and only while New — is dropped with them, because it existed to
--      protect a record that now protects itself.
--
-- And the SLA moves from the request type to the severity. A type says what
-- kind of problem it is; severity says what it costs the customer, and that is
-- what the team actually commits a response time to. The clock still runs from
-- submission, unchanged — an untriaged ticket is simply measured against no
-- target until a severity gives it one, and then against the whole elapsed
-- time, not from the moment of triage.
--
-- Existing tickets keep null submitted_* values: they were submitted before
-- anything was recorded, and guessing that the current value is the original
-- would report "never reclassified" for rows nobody can vouch for. Reports must
-- read null as "unknown" and leave those rows out.
--
-- Safe to re-run.
-- ============================================================

-- ---------- the snapshot columns ----------
alter table public.issues add column if not exists submitted_type     text;
alter table public.issues add column if not exists submitted_product  text;
alter table public.issues add column if not exists submitted_area     text;
alter table public.issues add column if not exists submitted_priority text;

comment on column public.issues.submitted_type is
  'How the request classified itself when it arrived. Stamped at insert, frozen
   afterwards. Null on tickets that predate the snapshot — read that as unknown,
   not as "unchanged".';
comment on column public.issues.submitted_product is
  'The product the request named when it arrived. Frozen; `product` is the
   team''s current filing and may differ.';
comment on column public.issues.submitted_area is
  'The area the request named when it arrived. Frozen; `area` is the team''s
   current filing and may differ.';
comment on column public.issues.submitted_priority is
  'The requester''s own ranking when it arrived. Frozen — and so is `priority`,
   so today these two can only agree. The column exists so that stays true by
   record rather than by assumption.';

-- ---------- the SLA moves to severity ----------
alter table public.list_items drop constraint if exists list_items_sla_only_on_severity;

-- Types no longer carry a target. Cleared rather than left to rot: a stale
-- number in a column nothing reads is a number somebody will eventually quote.
update public.list_items set sla_hours = null
  where list_type <> 'severity' and sla_hours is not null;

-- Only severities have one, from here on.
alter table public.list_items add constraint list_items_sla_only_on_severity
  check (sla_hours is null or list_type = 'severity');

-- Seed a target for each severity that has none. `is null` rather than an
-- unconditional set, so re-running this never undoes what an admin has tuned on
-- the Configuration page.
update public.list_items set sla_hours = v.hours
  from (values ('Critical', 4), ('High', 8), ('Moderate', 24), ('Low', 72))
       as v(name, hours)
  where list_items.list_type = 'severity'
    and list_items.name = v.name
    and list_items.sla_hours is null;

comment on column public.list_items.sla_hours is
  'Hours from submission until the ticket should reach a Closed status. Severity
   rows only — the commitment belongs to what the ticket costs the customer, not
   to what kind of request it is. Null means this severity carries no target.';

-- ---------- stamping the snapshot ----------
-- Folded into the trigger that already decides what an insert is allowed to
-- claim for itself. It runs after nothing and before everything: the values
-- here are the ones the client sent, which is exactly what "as submitted" means.
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

  -- What the request said about itself, kept whatever happens to it later.
  -- Always taken from the live fields, never from the client: a caller that
  -- sends its own submitted_* is describing a submission it did not make.
  new.submitted_type     := new.type;
  new.submitted_product  := new.product;
  new.submitted_area     := new.area;
  new.submitted_priority := new.priority;

  return new;
end $$;

drop trigger if exists issues_stamp_origin on public.issues;
create trigger issues_stamp_origin before insert on public.issues
  for each row execute function public.stamp_issue_origin();

-- ---------- what may still change afterwards ----------
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
