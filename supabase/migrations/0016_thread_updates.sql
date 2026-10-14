-- ============================================================
-- 0016 — status changes and emails, replied into the ticket's Chat thread
--
-- Migration 0015 gave every newly announced ticket its own Google Chat thread
-- and recorded it in `issues.chat_thread`. What happens to the ticket after
-- that now follows it into the thread, one line each:
--
--   * a status change — the new status, who made it, and when;
--   * an email — sent to the requester (and by whom) or received from them.
--
-- Only that: the email's subject and body stay on the ticket. A Chat space is
-- a wider audience than the ticket's project, and the content of a customer's
-- email is the customer's.
--
-- Same path as the new-ticket card: an AFTER INSERT trigger queues a call to
-- `notify-issue` through pg_net with nothing but the row's id, and the function
-- reads the rest with service_role. Same Vault secrets, same rule — nothing in
-- here can fail the insert it hangs off.
--
-- Skipped, without a call, for a ticket with no recorded thread: one announced
-- before 0015, one whose announcement failed, and wherever notifications are
-- not configured. A status line or an email with no card above it would be a
-- thread about nothing. The ticket's first status event (from nothing to New)
-- is the announcement itself, so it is skipped too.
--
-- Safe to re-run.
-- ============================================================

-- Queues one call to notify-issue. A no-op until both Vault secrets exist (see
-- migration 0001), and never raises.
create or replace function public.post_issue_notification(p_body jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'notify_issue_url' limit 1;
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'notify_issue_secret' limit 1;

  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'x-notify-secret', v_secret
    ),
    body    := p_body
  );
exception when others then
  -- A missing Vault, a full pg_net queue: a Chat line is never worth an error.
  return;
end $$;

-- Not callable from the browser: it carries the shared secret to whatever body
-- it is handed.
revoke all on function public.post_issue_notification(jsonb) from public, anon, authenticated;

-- Whether the ticket has a thread to reply into.
create or replace function public.issue_has_chat_thread(p_issue_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.issues where id = p_issue_id and chat_thread is not null
  );
$$;

revoke all on function public.issue_has_chat_thread(uuid) from public, anon, authenticated;

-- ---------- status changes ----------
create or replace function public.notify_status_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.from_status is not null and public.issue_has_chat_thread(new.issue_id) then
    perform public.post_issue_notification(jsonb_build_object('status_event_id', new.id));
  end if;
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists status_events_notify on public.status_events;
create trigger status_events_notify after insert on public.status_events
  for each row execute function public.notify_status_event();

-- ---------- emails ----------
-- A row exists only once Mailgun has accepted a send (email-send) or a message
-- has arrived (email-webhook), so every insert is an email that really went or
-- came. Delivery updates afterwards are not inserts and post nothing.
create or replace function public.notify_email_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.issue_has_chat_thread(new.issue_id) then
    perform public.post_issue_notification(jsonb_build_object('email_message_id', new.id));
  end if;
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists email_messages_notify on public.email_messages;
create trigger email_messages_notify after insert on public.email_messages
  for each row execute function public.notify_email_message();
