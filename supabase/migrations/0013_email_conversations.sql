-- ============================================================
-- 0013 — email conversations on a ticket
--
-- The customer conversation moves out of a shared inbox and onto the ticket.
-- Staff who are allowed to (`profiles.can_email`) write to the requester from
-- the ticket's Conversation tab; the email goes out through Mailgun from the
-- `email-send` function, and every reply comes back through Mailgun to the
-- `email-webhook` function, which files it on the right ticket. A fresh email
-- to the support address — forwarded into Mailgun — becomes a new ticket.
--
-- How a reply finds its ticket:
--   1. The Reply-To on everything we send is `t-<email_token>@<mail domain>`.
--      The token is random and per ticket. It is deliberately not the ticket
--      reference: ACME-42 is public and guessable (see CLAUDE.md), and an
--      address built from it would let anyone write into any ticket's thread.
--   2. Failing that, the reply's In-Reply-To / References naming a message we
--      already hold — a customer replying to their own first email, say.
--   3. Failing both, it is a new request, and becomes a new ticket.
--
-- Every write to `email_messages` is made by those two functions with
-- service_role. The browser only reads, and only what it could already see:
-- the thread of a ticket in one of its projects.
--
-- Safe to re-run.
-- ============================================================

-- ---------- the ticket's reply token ----------
-- 32 hex characters from gen_random_uuid() — 122 random bits, and core
-- Postgres, so no extension to depend on. Staff can read it (they can read the
-- row); the public functions never send it, because they send allow-lists.
alter table public.issues add column if not exists email_token text;
update public.issues
   set email_token = replace(gen_random_uuid()::text, '-', '')
 where email_token is null;
alter table public.issues
  alter column email_token set default replace(gen_random_uuid()::text, '-', '');
alter table public.issues alter column email_token set not null;
create unique index if not exists issues_email_token_idx on public.issues(email_token);

-- ---------- the thread ----------
create table if not exists public.email_messages (
  id            uuid primary key default gen_random_uuid(),
  issue_id      uuid not null references public.issues(id) on delete cascade,
  direction     text not null check (direction in ('outbound', 'inbound')),
  from_email    text,
  from_name     text,
  to_emails     text[] not null default '{}',
  cc_emails     text[] not null default '{}',
  subject       text,
  -- The whole message as text, and the part a person actually wrote: Mailgun
  -- strips the quoted history and signature into `stripped_text`, which is what
  -- the thread shows. The HTML is kept for the record and never rendered.
  body_text     text,
  body_html     text,
  stripped_text text,
  -- RFC 5322 Message-ID, without the angle brackets. Unique so a webhook that
  -- Mailgun retries files the message once.
  message_id    text not null unique,
  in_reply_to   text,
  "references"  text[] not null default '{}',
  -- Who sent it, for an outbound message. Kept when the account goes.
  sent_by       uuid references public.profiles(id) on delete set null,
  -- outbound: sent → delivered | failed. inbound: received.
  status        text not null check (status in ('sent', 'delivered', 'failed', 'received')),
  error         text,
  -- Mailgun's id for an outbound message, which its delivery events carry.
  provider_id   text,
  created_at    timestamptz not null default now()
);
create index if not exists email_messages_issue_idx on public.email_messages(issue_id, created_at);
create index if not exists email_messages_provider_idx on public.email_messages(provider_id)
  where provider_id is not null;

comment on table public.email_messages is
  'The email thread with the requester. Written only by the email-send and
   email-webhook functions (service_role); staff read their projects'' threads.';

alter table public.email_messages enable row level security;

drop policy if exists email_messages_read on public.email_messages;
create policy email_messages_read on public.email_messages for select to authenticated
  using (public.can_see_issue(issue_id));

-- ---------- files on an email ----------
-- Same table and bucket as every other attachment, so signing and the gallery
-- work unchanged. A row with an `email_message_id` belongs to that email —
-- neither to the request nor to a comment — and only the functions write one.
alter table public.attachments
  add column if not exists email_message_id uuid references public.email_messages(id) on delete cascade;
create index if not exists attachments_email_idx on public.attachments(email_message_id)
  where email_message_id is not null;

drop policy if exists att_public_insert on public.attachments;
create policy att_public_insert on public.attachments for insert to anon, authenticated
  with check (
    email_message_id is null
    and (comment_id is null or public.can_modify_comment(comment_id, issue_id))
  );

-- What was sent or received is a record; nobody tidies it away from the browser.
drop policy if exists att_staff_delete on public.attachments;
create policy att_staff_delete on public.attachments for delete to authenticated
  using (
    public.can_see_issue(issue_id)
    and email_message_id is null
    and (comment_id is null or public.can_modify_comment(comment_id, issue_id))
  );

-- ---------- who may write to customers ----------
-- A per-person grant, not a role: who speaks for the team to a customer is a
-- separate decision from what someone may do with tickets. Admins set it, via
-- admin-users.
alter table public.profiles add column if not exists can_email boolean not null default false;

-- The self-write freeze gains `can_email`, and so does the manager path:
-- `profiles_manager_update` lets a manager write a member's row, and a manager
-- must not be able to hand out the grant either. service_role (auth.uid() is
-- null) — which is how admin-users writes — is unaffected.
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
  if auth.uid() is not null and not public.is_admin() then
    new.can_email := old.can_email;
  end if;
  return new;
end;
$$;

-- ---------- tickets created from an email ----------
-- `auth.uid() is null` used to mean "the public form", but the email-webhook
-- function inserts with service_role and has no uid either. It is told apart by
-- its role: it may name its channel (Email), may never claim `Form`, and is
-- pinned to now and stripped of severity just like the form — nobody has
-- triaged an email that has only just arrived.
create or replace function public.stamp_issue_origin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null and coalesce(auth.role(), '') = 'service_role' then
    if new.source is null or new.source = 'Form' then
      raise exception 'A ticket created by a server function must name its channel, and it may not be `Form`';
    end if;
    new.submitted_date := now();
    new.severity       := null;
  elsif auth.uid() is null then
    new.source         := 'Form';
    new.submitted_date := now();
    new.severity       := null;
  else
    if new.source = 'Form' then
      raise exception '`Form` is reserved for requests submitted through the public form';
    end if;
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
