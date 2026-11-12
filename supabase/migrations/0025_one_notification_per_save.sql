-- 0025 — one notification per person per save, as in Elevance Work.
--
-- A save that changed a ticket's status and its assignees together reached
-- people through two triggers: `issues_notify_assignees` for the assignees,
-- and `status_events_notify_watchers` (fired by the status event that save
-- logs) for the watchers. A newly assigned person is a watcher by then, so
-- they were told twice ("assigned" and "status changed"), and the save made
-- two calls to push-send.
--
-- Now one trigger on `issues` handles both, through one notify_people call:
-- one call per save, and one notification per person, the first of assigned
-- then status changed. The status the save moved the ticket to rides along as
-- `detail` on every row, so "assigned" can say "and moved it to Closed". The
-- ticket arriving (its first status) is still not a move. Comments (mention
-- beats comment) and inbound email were already one call each.

drop trigger if exists issues_notify_assignees on public.issues;
drop trigger if exists status_events_notify_watchers on public.status_events;
drop function if exists public.notify_issue_assignees();
drop function if exists public.notify_watchers_status();

create or replace function public.notify_issue_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor    uuid := auth.uid();
  v_added    uuid[] := '{}';
  v_watchers uuid[] := '{}';
  v_moved    text;
  w uuid;
begin
  if tg_op = 'INSERT' then
    -- The rota, or the person logging it; the ticket arriving is not a move.
    v_added := coalesce(new.assignee_ids, '{}');
    perform public.auto_watch(new.id, v_actor);
  else
    if new.assignee_ids is distinct from old.assignee_ids then
      -- Only who this save adds: taking somebody off notifies nobody.
      select coalesce(array_agg(a), '{}') into v_added
      from unnest(new.assignee_ids) a
      where not (a = any (coalesce(old.assignee_ids, '{}')));
    end if;
    if new.status is distinct from old.status then
      v_moved := new.status;
    end if;
  end if;

  foreach w in array v_added loop
    perform public.auto_watch(new.id, w);
  end loop;
  -- Read after the new assignees watch it: they are listed first, so they
  -- hear it once, as assigned.
  if v_moved is not null then
    v_watchers := array(select public.watchers_of(new.id));
  end if;
  perform public.notify_people(
    v_added || v_watchers,
    public.same_kind('assigned', v_added) || public.same_kind('status_changed', v_watchers),
    new.id, v_actor, null, null, v_moved);
  return null;
exception when others then
  -- A notification is never worth a failed ticket.
  return null;
end $$;
revoke all on function public.notify_issue_change() from public, anon, authenticated;

drop trigger if exists issues_notify_change on public.issues;
create trigger issues_notify_change after insert or update of assignee_ids, status on public.issues
  for each row execute function public.notify_issue_change();
