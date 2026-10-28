-- ============================================================
-- 0019 — a comment, replied into the ticket's Chat thread on request
--
-- The comment box gains a "Notify in thread" checkbox, off by default. When
-- it is ticked, the comment is posted into the ticket's Google Chat thread
-- (migration 0015) as one reply: who wrote it, and what they wrote. Unlike a
-- status line or an email line (0016), the text goes too — the author chose to
-- share it there, and a comment is the team's own words, not the customer's.
--
--   * comments.notify_thread — the author's choice, recorded on the row. Only
--     the insert reads it: an edit inside the 5-minute window posts nothing
--     more, so the thread holds the comment as first written.
--
-- Same path as 0016: an AFTER INSERT trigger queues a call to `notify-issue`
-- through pg_net with nothing but the row's id, and the function reads the
-- rest with service_role. Skipped, without a call, for a ticket with no
-- recorded thread — the box is disabled there too. Nothing here can fail the
-- insert.
--
-- Safe to re-run.
-- ============================================================

alter table public.comments
  add column if not exists notify_thread boolean not null default false;

create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.notify_thread and public.issue_has_chat_thread(new.issue_id) then
    perform public.post_issue_notification(jsonb_build_object('comment_id', new.id));
  end if;
  return new;
exception when others then
  return new;
end $$;

drop trigger if exists comments_notify on public.comments;
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_comment();
