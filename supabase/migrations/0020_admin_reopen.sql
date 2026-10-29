-- ============================================================
-- 0020 — an admin may reopen a closed ticket
--
-- A ticket still only moves forward: new -> in_progress -> closed. The one
-- exception is a ticket closed by mistake. An admin may move it from a closed
-- status back to an in_progress one — not to new (somebody has already looked
-- at it) and not to paused (a closed ticket still has nothing to pause).
--
-- The other gates still apply on the way back: entering in_progress needs a
-- severity, and leaving new-or-closed for in_progress needs an assignee. Moving
-- out of closed already clears `closed_at`, so the SLA clock picks up again
-- from submission.
--
-- Only `enforce_issue_rules` changes; it is restated whole from 0008.
--
-- Safe to re-run.
-- ============================================================

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
    elsif eff_type = 'closed' and new_type = 'in_progress'
          and actor_role = 'admin' then
      -- Reopening a ticket closed by mistake: an admin's call, and only back
      -- into the work, never to New.
      null;
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
