-- ============================================================
-- 0017 — the email addresses a project has dealt with
--
-- Staff type the same customer addresses again and again: as the requester of
-- a ticket they log by hand, and in the Cc of the emails they send. Each
-- project now keeps the addresses it has met, so those two boxes can suggest
-- them.
--
-- An address is kept when it is actually used, never when it is typed:
--   * a ticket's requester email, when the ticket is created — by the public
--     form, by staff, or by an email arriving (email-webhook);
--   * a Cc on an email the team sent — the `email_messages` row exists only
--     once Mailgun has accepted the send, so a draft that never went is never
--     remembered.
--
-- Per project, like everything a ticket says: the addresses are the project's
-- customers, and only its members see them. Never readable by anon — the key
-- is public, and this is a list of customers' addresses. The browser only
-- reads; the triggers below are the only writers.
--
-- Names come from tickets: the requester name, newest wins. An address with no
-- name yet (one only ever Cc'd) takes the display name it next writes in under.
--
-- One-time backfill at the end: every requester address already on a ticket,
-- every Cc already sent, and names from emails already received.
--
-- Safe to re-run.
-- ============================================================

create table if not exists public.project_contacts (
  project_id   uuid not null references public.projects(id) on delete cascade,
  -- Lower-cased and trimmed: Jane@Acme.com and jane@acme.com are one person.
  email        text not null check (email = lower(btrim(email))),
  -- The name it last came with — a requester's. A Cc carries none, and never
  -- wipes one already known.
  name         text,
  -- Suggestions come newest first: whoever the project wrote to last week
  -- before whoever it wrote to last year.
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  primary key (project_id, email)
);
create index if not exists project_contacts_recent_idx
  on public.project_contacts(project_id, last_seen_at desc);

comment on table public.project_contacts is
  'Email addresses a project has met: ticket requesters and Cc''d recipients of
   sent emails. Written only by triggers; read by the project''s members.';

alter table public.project_contacts enable row level security;

drop policy if exists project_contacts_read on public.project_contacts;
create policy project_contacts_read on public.project_contacts for select to authenticated
  using (public.is_project_member(project_id));

-- ---------- remembering one ----------
-- Mirrors isEmail() in src/lib/email.js: one @, no spaces, a dot in the
-- domain. Anything else is not worth suggesting back to anyone.
create or replace function public.remember_contact(
  p_project uuid, p_email text, p_name text default null, p_seen timestamptz default now()
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if p_project is null
     or v_email !~ '^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$' then
    return;
  end if;

  insert into public.project_contacts as c (project_id, email, name, last_seen_at)
  values (p_project, v_email, v_name, coalesce(p_seen, now()))
  on conflict (project_id, email) do update
    set name         = coalesce(excluded.name, c.name),
        last_seen_at = greatest(c.last_seen_at, excluded.last_seen_at);
end $$;

-- Trigger-only: callable from the browser it would let anyone with a session
-- plant addresses in any project's suggestions.
revoke all on function public.remember_contact(uuid, text, text, timestamptz) from public, anon, authenticated;

-- ---------- the requester of a ticket ----------
-- AFTER, so it sees the row as the before-triggers left it. Also on a change
-- of address, should one ever be edited in — but a save that merely resends
-- the same address is not a new sighting.
create or replace function public.remember_issue_requester()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.requester_email is not distinct from old.requester_email then
    return null;
  end if;
  perform public.remember_contact(new.project_id, new.requester_email, new.requester_name);
  return null;
exception when others then
  -- A suggestion list is never worth failing a ticket over.
  return null;
end $$;

drop trigger if exists issues_remember_requester on public.issues;
create trigger issues_remember_requester
  after insert or update of requester_email on public.issues
  for each row when (new.requester_email is not null)
  execute function public.remember_issue_requester();

-- ---------- the Cc of a sent email ----------
-- Outbound only: these are the people a member of staff chose to copy. Who a
-- customer copies on their reply is theirs to decide, not ours to keep.
create or replace function public.remember_email_cc()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
  v_cc      text;
begin
  select project_id into v_project from public.issues where id = new.issue_id;
  foreach v_cc in array coalesce(new.cc_emails, '{}') loop
    perform public.remember_contact(v_project, v_cc, null, new.created_at);
  end loop;
  return null;
exception when others then
  -- The email has already gone; recording it must not fail over this.
  return null;
end $$;

drop trigger if exists email_messages_remember_cc on public.email_messages;
create trigger email_messages_remember_cc
  after insert on public.email_messages
  for each row when (new.direction = 'outbound' and cardinality(new.cc_emails) > 0)
  execute function public.remember_email_cc();

-- ---------- a name from the customer's own email ----------
-- A Cc carries no name, so an address first met as one stays nameless until
-- it writes in. When it does, the display name on its From line (`Jane Doe
-- <jane@acme.com>`) fills the gap. It never adds an address — who writes in
-- is not who the team chose to deal with — and never replaces a name a ticket
-- gave: a requester's name is what staff typed or the customer chose to give,
-- a mail app's display name is a guess. A "name" that is just an address again
-- is no name.
create or replace function public.remember_sender_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.project_contacts c
     set name = btrim(new.from_name)
    from public.issues i
   where i.id = new.issue_id
     and c.project_id = i.project_id
     and c.email = lower(btrim(new.from_email))
     and c.name is null;
  return null;
exception when others then
  -- The email is already filed; a name is never worth losing it over.
  return null;
end $$;

drop trigger if exists email_messages_remember_sender_name on public.email_messages;
create trigger email_messages_remember_sender_name
  after insert on public.email_messages
  for each row when (
    new.direction = 'inbound' and new.from_email is not null
    and nullif(btrim(new.from_name), '') is not null and new.from_name not like '%@%'
  )
  execute function public.remember_sender_name();

-- ---------- one-time backfill ----------
-- Every address already on a ticket, with the name from its newest ticket that
-- has one, last seen when that address last asked for something.
insert into public.project_contacts as c (project_id, email, name, last_seen_at)
select project_id, email,
       (array_agg(name order by seen desc) filter (where name is not null))[1],
       max(seen)
  from (
    select i.project_id,
           lower(btrim(i.requester_email))            as email,
           nullif(btrim(i.requester_name), '')        as name,
           coalesce(i.submitted_date, i.created_at)   as seen
      from public.issues i
     where lower(btrim(i.requester_email)) ~ '^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$'
  ) r
 group by project_id, email
on conflict (project_id, email) do update
  set name         = coalesce(excluded.name, c.name),
      last_seen_at = greatest(c.last_seen_at, excluded.last_seen_at);

-- Every Cc the team has already sent to.
insert into public.project_contacts as c (project_id, email, last_seen_at)
select i.project_id, lower(btrim(cc)), max(m.created_at)
  from public.email_messages m
  join public.issues i on i.id = m.issue_id
  cross join lateral unnest(m.cc_emails) as cc
 where m.direction = 'outbound'
   and lower(btrim(cc)) ~ '^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$'
 group by i.project_id, lower(btrim(cc))
on conflict (project_id, email) do update
  set last_seen_at = greatest(c.last_seen_at, excluded.last_seen_at);

-- Then a name for each address still without one, from the newest email it
-- sent in under a display name.
update public.project_contacts c
   set name = s.name
  from (
    select distinct on (i.project_id, lower(btrim(m.from_email)))
           i.project_id, lower(btrim(m.from_email)) as email, btrim(m.from_name) as name
      from public.email_messages m
      join public.issues i on i.id = m.issue_id
     where m.direction = 'inbound' and m.from_email is not null
       and nullif(btrim(m.from_name), '') is not null and m.from_name not like '%@%'
     order by i.project_id, lower(btrim(m.from_email)), m.created_at desc
  ) s
 where c.project_id = s.project_id and c.email = s.email and c.name is null;
