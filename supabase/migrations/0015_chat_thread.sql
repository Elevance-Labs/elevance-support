-- ============================================================
-- 0015 — the Google Chat thread a ticket was announced in
--
-- `notify-issue` posts each new ticket into Chat with a `threadKey` of the
-- ticket reference (ACME-42), so the ticket owns one thread in the space and
-- anything posted for it later lands in that thread. Chat answers the post with
-- the message it created; the function keeps that message's thread resource
-- name (`spaces/<space>/threads/<thread>`) here, and the ticket dialog turns it
-- into a "View thread" link.
--
-- Stored as the resource name, not a URL: the name is what Chat's API hands
-- back and will keep accepting, while the web address that opens it is
-- Google's to change — so the URL is built in the browser (src/lib/chat.js),
-- in one place.
--
-- Only `notify-issue` writes it, with service_role. A ticket is never pointed
-- at a thread by a browser: an insert from anyone else has it dropped, and an
-- update from anyone else that changes it is refused.
--
-- Null on tickets announced before this shipped, on any whose announcement
-- failed, and wherever notifications are not configured.
--
-- Safe to re-run.
-- ============================================================

alter table public.issues add column if not exists chat_thread text;

comment on column public.issues.chat_thread is
  'Google Chat thread the ticket was announced in (spaces/<space>/threads/<thread>). '
  'Written only by the notify-issue function.';

create or replace function public.guard_issue_chat_thread()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null and coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.chat_thread := null;
  elsif new.chat_thread is distinct from old.chat_thread then
    raise exception 'A ticket''s Chat thread is recorded by the notification, not set by hand'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists issues_guard_chat_thread on public.issues;
create trigger issues_guard_chat_thread before insert or update on public.issues
  for each row execute function public.guard_issue_chat_thread();
