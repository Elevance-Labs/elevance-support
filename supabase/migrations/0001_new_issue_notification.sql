-- ============================================================
-- 0001 — notify the team when a new ticket arrives
--
-- A ticket can be created from the public embed form or from the staff Create
-- Issue dialog. Both end up as one insert into `issues`, so the notification
-- hangs off the insert rather than off either caller — the same reason the
-- ticket number and the first status event are triggers.
--
-- The HTTP call is made with pg_net, which queues the request and returns
-- immediately. That is the point: a customer's form submission must not fail
-- because Google Chat is unreachable. Nothing in here can roll the insert back
-- — every failure path returns NEW.
--
-- Ordering: this runs AFTER INSERT, so `number` (issues_assign_number) and the
-- default status (issues_default_status) are already set and the share link is
-- already addressable.
--
-- Safe to re-run.
-- ============================================================

-- pg_net lives in `extensions` on Supabase; net.http_post() is what it gives us.
create extension if not exists pg_net with schema extensions;

-- The function URL and the shared secret are secrets, so they are read from
-- Vault at call time rather than written into this file. Create them once per
-- environment (see README, "New-ticket notifications"):
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify-issue',
--                              'notify_issue_url');
--   select vault.create_secret('<a long random string>', 'notify_issue_secret');
--
-- Until both exist the trigger is a no-op, which is the desired state for a
-- local or preview database that should not page anyone.
create or replace function public.notify_new_issue()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url    text;
  v_secret text;
begin
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'notify_issue_url' limit 1;
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'notify_issue_secret' limit 1;
  exception when others then
    -- No Vault (or no read on it) means no notifications, never a failed insert.
    return new;
  end;

  if v_url is null or v_secret is null then
    return new;
  end if;

  -- Only the id travels. The edge function re-reads the row with service_role
  -- so the message's field list lives in one place, in TypeScript, next to the
  -- card that renders it — not split across a SQL payload.
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      -- The function is deployed with --no-verify-jwt (the database is not a
      -- signed-in user), so this header is what authenticates the caller.
      'x-notify-secret', v_secret
    ),
    body    := jsonb_build_object('issue_id', new.id)
  );

  return new;
exception when others then
  -- Belt and braces: a notification is never worth losing a ticket over.
  return new;
end $$;

drop trigger if exists issues_notify_new on public.issues;
create trigger issues_notify_new after insert on public.issues
  for each row execute function public.notify_new_issue();
