-- ============================================================
-- 0023 — watching tickets, @mentions, and notifications (in the app and pushed
-- to devices)
--
-- Until now the only way to hear about a ticket was its Google Chat thread,
-- which is a shared space: it tells everybody everything, and nobody in
-- particular that something needs them. This gives each person their own
-- feed, about the tickets they are on.
--
--   * issue_watchers — who follows a ticket. A row per person per ticket, with
--     `watching` true or false. Unwatching writes false rather than deleting,
--     so that the automatic watches below (being assigned, commenting, being
--     mentioned) never quietly re-add somebody who chose to leave: an
--     automatic watch only ever inserts, and an existing row — either way —
--     wins.
--
--   * @mentions — a comment's rich text document (0018) may carry a mention:
--     a run with a `mention` key holding a profile id. Read here straight from
--     `body_doc`, never from the text, so typing "@Ada" by hand mentions no one.
--     An edit inside the 5-minute window notifies only the people it adds.
--
--   * notifications — one row per person per thing that happened. Written only
--     by the triggers here (security definer); the browser reads its own,
--     marks them read, and deletes them. Never to the person who caused it, to
--     an inactive account, or to someone who cannot see the ticket. One event
--     gives a person at most one notification: a comment that mentions you is
--     a mention, not also a comment.
--
--       assigned        you were put on a ticket (by hand, or by the rota)
--       mentioned       a comment @mentions you
--       commented       a comment on a ticket you watch
--       status_changed  a ticket you watch moved
--       email_received  the customer wrote in on a ticket you watch
--       test            you asked for one, from /profile
--
--   * push_subscriptions — the devices a person has turned notifications on
--     for (Web Push). Written through save_push_subscription() rather than
--     the table, so a shared device always belongs to whoever turned it on
--     last, and checking a device can never re-register one that was removed.
--
-- Push: an AFTER INSERT statement trigger on `notifications` queues one call
-- to the `push-send` Edge Function through pg_net, with the new rows' ids —
-- one call per write, however many people it notified. Same Vault secrets and
-- same rule as the Chat notifications (0001, 0016): until they exist nothing is
-- sent, and nothing here can fail the write it hangs off.
--
-- Safe to re-run.
-- ============================================================

-- ---------- who may see a ticket, for someone other than the caller ----------
-- can_see_issue() answers for auth.uid(). A notification is about the
-- recipient, so the same rule — admins see every project, everybody else the
-- ones they belong to — is asked for them, plus that the account is active.
create or replace function public.user_can_see_issue(p_user uuid, p_issue uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.issues i
    join public.profiles p on p.id = p_user and p.is_active
    where i.id = p_issue
      and (p.role = 'admin'
           or exists (select 1 from public.project_members m
                      where m.project_id = i.project_id and m.user_id = p_user))
  );
$$;
revoke all on function public.user_can_see_issue(uuid, uuid) from public, anon, authenticated;

-- ---------- watchers ----------
create table if not exists public.issue_watchers (
  issue_id   uuid not null references public.issues(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  -- false: this person unwatched it, and stays unwatched until they say so.
  watching   boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);
create index if not exists issue_watchers_user_idx on public.issue_watchers(user_id);

comment on table public.issue_watchers is
  'Who follows a ticket. watching=false is a deliberate unwatch, which the automatic watches never override.';

alter table public.issue_watchers enable row level security;

-- Everyone who can see the ticket sees who watches it; each person writes only
-- their own row, and only on a ticket they can see.
drop policy if exists issue_watchers_read on public.issue_watchers;
create policy issue_watchers_read on public.issue_watchers for select to authenticated
  using (public.can_see_issue(issue_id));

drop policy if exists issue_watchers_insert on public.issue_watchers;
create policy issue_watchers_insert on public.issue_watchers for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_issue(issue_id));

drop policy if exists issue_watchers_update on public.issue_watchers;
create policy issue_watchers_update on public.issue_watchers for update to authenticated
  using (user_id = auth.uid() and public.can_see_issue(issue_id))
  with check (user_id = auth.uid() and public.can_see_issue(issue_id));

-- No delete: an unwatch is a row saying so (see above).
revoke delete on public.issue_watchers from authenticated;

-- An automatic watch: inserts, never overrides an existing row either way.
create or replace function public.auto_watch(p_issue uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or not public.user_can_see_issue(p_user, p_issue) then
    return;
  end if;
  insert into public.issue_watchers (issue_id, user_id) values (p_issue, p_user)
  on conflict (issue_id, user_id) do nothing;
end $$;
revoke all on function public.auto_watch(uuid, uuid) from public, anon, authenticated;

-- The people watching a ticket now.
create or replace function public.watchers_of(p_issue uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from public.issue_watchers where issue_id = p_issue and watching;
$$;
revoke all on function public.watchers_of(uuid) from public, anon, authenticated;

-- ---------- mentions ----------
-- The profile ids a rich text document mentions: every run's `mention`, in a
-- paragraph or in a list item. Anything that is not a uuid is ignored — the
-- document is the browser's, so it is read, not trusted. Mirrors
-- mentionedIds() in src/lib/richText.js.
create or replace function public.mentioned_ids(p_doc jsonb)
returns uuid[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct m::uuid), '{}')
  from (
    select jsonb_path_query(p_doc, 'lax $.blocks[*].runs[*].mention') #>> '{}' as m
    union all
    select jsonb_path_query(p_doc, 'lax $.blocks[*].items[*][*].mention') #>> '{}'
  ) found
  where p_doc is not null
    and m ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

-- ---------- notifications ----------
create table if not exists public.notifications (
  id               uuid primary key default gen_random_uuid(),
  recipient_id     uuid not null references public.profiles(id) on delete cascade,
  -- Who caused it; null for the public form, an inbound email, or the rota.
  actor_id         uuid references public.profiles(id) on delete set null,
  kind             text not null
                   check (kind in ('assigned','mentioned','commented','status_changed',
                                   'email_received','test')),
  issue_id         uuid references public.issues(id) on delete cascade,
  comment_id       uuid references public.comments(id) on delete cascade,
  email_message_id uuid references public.email_messages(id) on delete cascade,
  -- A word of context: the new status, or who an email came from.
  detail           text,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists notifications_recipient_idx
  on public.notifications(recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications(recipient_id, issue_id) where read_at is null;

comment on table public.notifications is
  'One per person per event, written by triggers only. The recipient reads, marks read and deletes their own.';

alter table public.notifications enable row level security;

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (recipient_id = auth.uid());

drop policy if exists notifications_mark on public.notifications;
create policy notifications_mark on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (recipient_id = auth.uid());

-- No insert policy: only the security definer functions below write them. And
-- of a row the browser may change one column — whether it has been read.
revoke insert, update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- The notifications one event causes, written in one statement — so the push
-- trigger below makes one call per event, however many people it reaches.
--
-- `p_recipients` and `p_kinds` are parallel, in priority order: someone listed
-- twice gets the first kind they appear with (a comment that mentions a
-- watcher is a mention, not also a comment). Skipped: nobody, whoever caused
-- it, an inactive account, someone who cannot see the ticket.
create or replace function public.notify_people(
  p_recipients uuid[], p_kinds text[], p_issue uuid, p_actor uuid,
  p_comment uuid default null, p_email uuid default null, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications
    (recipient_id, actor_id, kind, issue_id, comment_id, email_message_id, detail)
  select r, p_actor, k, p_issue, p_comment, p_email, p_detail
  from (
    select distinct on (r) r, k
    from unnest(p_recipients, p_kinds) with ordinality as t(r, k, n)
    where r is not null and r is distinct from p_actor
    order by r, n
  ) chosen
  where public.user_can_see_issue(r, p_issue);
end $$;
revoke all on function public.notify_people(uuid[], text[], uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- The same kind for everyone in a list.
create or replace function public.same_kind(p_kind text, p_people uuid[])
returns text[] language sql immutable as $$
  select array_fill(p_kind, array[coalesce(array_length(p_people, 1), 0)]);
$$;

-- ---------- assigned ----------
-- Whoever is added to `assignee_ids`, at insert (the rota, or the person
-- logging it) or later. Taking somebody off notifies nobody. The person who
-- logs a ticket from the staff form watches it too.
create or replace function public.notify_issue_assignees()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_added uuid[];
  w uuid;
begin
  if tg_op = 'INSERT' then
    v_added := new.assignee_ids;
    perform public.auto_watch(new.id, v_actor);
  else
    if new.assignee_ids is not distinct from old.assignee_ids then
      return null;
    end if;
    select coalesce(array_agg(a), '{}') into v_added
    from unnest(new.assignee_ids) a
    where not (a = any (coalesce(old.assignee_ids, '{}')));
  end if;
  v_added := coalesce(v_added, '{}');

  foreach w in array v_added loop
    perform public.auto_watch(new.id, w);
  end loop;
  perform public.notify_people(v_added, public.same_kind('assigned', v_added), new.id, v_actor);
  return null;
exception when others then
  -- A notification is never worth a failed ticket.
  return null;
end $$;

drop trigger if exists issues_notify_assignees on public.issues;
create trigger issues_notify_assignees after insert or update of assignee_ids on public.issues
  for each row execute function public.notify_issue_assignees();

-- ---------- status changes ----------
-- The first event (from nothing to New) is the ticket arriving, not a move.
create or replace function public.notify_watchers_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_watchers uuid[] := array(select public.watchers_of(new.issue_id));
begin
  if new.from_status is null then
    return null;
  end if;
  perform public.notify_people(v_watchers, public.same_kind('status_changed', v_watchers),
                               new.issue_id, new.changed_by, null, null, new.to_status);
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists status_events_notify_watchers on public.status_events;
create trigger status_events_notify_watchers after insert on public.status_events
  for each row execute function public.notify_watchers_status();

-- ---------- comments and mentions ----------
create or replace function public.notify_comment_people()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mentioned uuid[] := public.mentioned_ids(new.body_doc);
  v_watchers  uuid[];
  w uuid;
begin
  if tg_op = 'UPDATE' then
    -- Only the people this edit adds: the rest were told when it was posted.
    select coalesce(array_agg(m), '{}') into v_mentioned
    from unnest(v_mentioned) m
    where not (m = any (public.mentioned_ids(old.body_doc)));
  else
    perform public.auto_watch(new.issue_id, new.author_id);
  end if;

  -- Read before the mentioned are added, so they are told once, as mentioned.
  v_watchers := case when tg_op = 'INSERT'
                     then array(select public.watchers_of(new.issue_id)) else '{}' end;
  foreach w in array v_mentioned loop
    perform public.auto_watch(new.issue_id, w);
  end loop;
  perform public.notify_people(
    v_mentioned || v_watchers,
    public.same_kind('mentioned', v_mentioned) || public.same_kind('commented', v_watchers),
    new.issue_id, new.author_id, new.id);
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists comments_notify_people on public.comments;
create trigger comments_notify_people after insert or update of body_doc on public.comments
  for each row execute function public.notify_comment_people();

-- ---------- the customer wrote in ----------
-- Inbound only: an email the team sent is already on the ticket as theirs. The
-- email that opened a ticket (email-webhook files a new `Email` ticket, then
-- its message) is the ticket arriving — its assignees have just been told —
-- so it notifies nobody a second time.
create or replace function public.notify_watchers_email()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_watchers uuid[] := array(select public.watchers_of(new.issue_id));
begin
  if new.direction is distinct from 'inbound' then
    return null;
  end if;
  if not exists (select 1 from public.email_messages
                 where issue_id = new.issue_id and id <> new.id) then
    return null;
  end if;
  perform public.notify_people(v_watchers, public.same_kind('email_received', v_watchers),
                               new.issue_id, null, null, new.id,
                               coalesce(nullif(new.from_name, ''), new.from_email));
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists email_messages_notify_watchers on public.email_messages;
create trigger email_messages_notify_watchers after insert on public.email_messages
  for each row execute function public.notify_watchers_email();

-- ---------- a test, from /profile ----------
-- The only notification a browser can cause directly, and only to itself:
-- proves the whole path — row, trigger, push-send, the device — end to end.
create or replace function public.send_test_notification()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  insert into public.notifications (recipient_id, kind) values (auth.uid(), 'test');
end $$;
revoke all on function public.send_test_notification() from public, anon;
grant execute on function public.send_test_notification() to authenticated;

-- ---------- devices (Web Push) ----------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- The push service's address for this browser on this device. Unique: one
  -- device, one owner.
  endpoint     text not null unique check (endpoint ~ '^https://' and length(endpoint) < 2048),
  -- The browser's public key and auth secret, base64url — what the payload is
  -- encrypted to (RFC 8291). Only push-send reads them.
  p256dh       text not null check (length(p256dh) between 80 and 100),
  auth         text not null check (length(auth) between 16 and 32),
  -- "Chrome on Android" — so a person can tell their devices apart.
  device       text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_read on public.push_subscriptions;
create policy push_subscriptions_read on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

revoke insert, update on public.push_subscriptions from anon, authenticated;

-- Turning a device on (`p_refresh_only` false): the device now belongs to
-- whoever is signed in, even if somebody else turned it on before — a shared
-- machine must not carry the last person's notifications to the next.
--
-- Checking it (`p_refresh_only` true, at every start and whenever the app
-- looks): never registers anything. If the device is yours its keys are
-- refreshed; if it is somebody else's, that registration ends — they are no
-- longer the one using this browser; if there is none — removed from Profile
-- on another device, or dropped by push-send as gone — it stays gone.
--
-- Returns whether this device now gets the caller's notifications, which is
-- what the app shows as on or off.
drop function if exists public.save_push_subscription(text, text, text, text);
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_device text default null,
  p_refresh_only boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  if p_refresh_only then
    select user_id into v_owner from public.push_subscriptions where endpoint = p_endpoint;
    if v_owner is null then
      return false;
    end if;
    if v_owner <> auth.uid() then
      delete from public.push_subscriptions where endpoint = p_endpoint;
      return false;
    end if;
    update public.push_subscriptions
      set p256dh = p_p256dh, auth = p_auth, device = coalesce(left(p_device, 80), device)
      where endpoint = p_endpoint;
    return true;
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_device, 80))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        device = excluded.device;
  return true;
end $$;
revoke all on function public.save_push_subscription(text, text, text, text, boolean) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text, boolean) to authenticated;

-- ---------- pushing ----------
-- Queues one call to push-send with the ids of the rows just written. The URL
-- is the `push_send_url` Vault secret when there is one; otherwise it is
-- notify-issue's URL with the function's name swapped, since both live side by
-- side. The shared secret is notify-issue's. A no-op until those exist.
create or replace function public.push_notifications()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ids    uuid[];
  v_url    text;
  v_secret text;
begin
  select array_agg(id) into v_ids from inserted;
  if v_ids is null then
    return null;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'push_send_url' limit 1;
  if v_url is null then
    select regexp_replace(decrypted_secret, 'notify-issue/?$', 'push-send') into v_url
      from vault.decrypted_secrets where name = 'notify_issue_url' limit 1;
  end if;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'notify_issue_secret' limit 1;
  if v_url is null or v_secret is null or v_url !~ 'push-send/?$' then
    return null;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret),
    body    := jsonb_build_object('notification_ids', to_jsonb(v_ids))
  );
  return null;
exception when others then
  return null;
end $$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  referencing new table as inserted
  for each statement execute function public.push_notifications();

-- ---------- live in the app ----------
-- The bell hears its rows as they are written; RLS decides whose.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime'
                       and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
