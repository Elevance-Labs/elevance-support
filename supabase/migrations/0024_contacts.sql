-- ============================================================
-- 0024 — contacts: the people behind a project's addresses
--
-- `project_contacts` (0017) remembers every address a project has met. The
-- Inbox groups those addresses into people: one contact, any number of
-- addresses — jane@acme.com and jane.doe@gmail.com are one customer. A
-- contact carries a name and notes; its addresses are the rows that point at
-- it. An address is not a person: it has no name of its own (the column 0017
-- gave it moves onto the contacts here, and is dropped).
--
--   * Every address belongs to exactly one contact. A newly met address gets
--     a contact of its own (trigger), named at once — never nameless.
--   * The name is the best one known, by where it came from (`name_source`):
--       email  — made from the address: jane.doe@acme.com → "Jane Doe";
--       sender — the display name on an email they sent in (a mail app's
--                guess);
--       ticket — the requester name on a ticket (what the customer gave, or
--                staff typed on the form);
--       staff  — typed in the Inbox.
--     A name from a better source replaces one from a weaker source, never
--     the other way, and nothing replaces a name staff typed.
--   * A name that came with an address (`name_email`) belongs to it: moved
--     elsewhere, the address takes its name along (offered to the contact it
--     joins, by the same rule), and the contact it left is named afresh from
--     the address it still has. A name staff typed is the contact's, and
--     stays.
--   * Staff may rename a contact and edit its notes (any project member), and
--     add an address to one or move an address between them — through
--     move_contact_email(), never by writing the rows directly.
--   * An address is never removed: there is no delete path from the browser.
--     A contact whose last address moves away is folded into the contact it
--     moved to (the better-sourced name kept, notes appended), so nothing
--     typed about it is lost.
--
-- Nothing else is filed under a contact. Emails and tickets name addresses
-- (From/To/Cc, the requester email); which contact they belong to is read
-- through the address, so moving an address moves its history with it — and
-- moving it again moves it again.
--
-- Per project, like the addresses: read and written only by the project's
-- members, never anon.
--
-- Typed addresses are new here. 0017 kept an address only once it was used;
-- the Inbox lets staff add one by hand to a contact, because a customer who
-- says "also write to my colleague" is a fact worth keeping.
--
-- Safe to re-run, including over an earlier draft of this migration.
-- ============================================================

create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  -- Where the name came from — what may replace it (see above).
  name_source text not null default 'email'
              check (name_source in ('email', 'sender', 'ticket', 'staff')),
  -- The address the name came with; null for one staff typed.
  name_email  text,
  notes       text check (notes is null or char_length(notes) <= 10000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  -- The composite key the addresses point at, so an address can only ever
  -- belong to a contact of its own project.
  unique (id, project_id)
);
create index if not exists contacts_project_idx on public.contacts(project_id);

comment on table public.contacts is
  'A person a project deals with: a name and notes over one or more of its
   project_contacts addresses. Project members read, rename and annotate;
   created and merged only by triggers and move_contact_email().';

-- An earlier draft had nameless contacts and no name_source. The names it
-- has are real ones (an address's, or typed), so they rank as a ticket's.
do $$ begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'contacts' and column_name = 'name_source'
  ) then
    alter table public.contacts add column name_source text not null default 'email'
      check (name_source in ('email', 'sender', 'ticket', 'staff'));
    update public.contacts set name_source = 'ticket' where name is not null;
  end if;
end $$;
alter table public.contacts add column if not exists name_email text;

alter table public.project_contacts add column if not exists contact_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'project_contacts_contact_fk') then
    -- No action (not cascade): deleting a contact that still has addresses is
    -- refused, so an address can never disappear with it. A project's delete
    -- still takes both, being checked at the end of the statement.
    alter table public.project_contacts
      add constraint project_contacts_contact_fk
      foreign key (contact_id, project_id) references public.contacts(id, project_id);
  end if;
end $$;
create index if not exists project_contacts_contact_idx on public.project_contacts(contact_id);

-- ---------- names ----------
-- Mirrors humanize() in src/lib/users.js: the local part, trailing digits
-- dropped, split on . _ - +, each word capitalised — jane.doe2@acme.com is
-- "Jane Doe". The local part as it is when nothing is left.
create or replace function public.name_from_email(p_email text)
returns text language sql immutable set search_path = public as $$
  select left(coalesce(
    (select string_agg(upper(left(w, 1)) || substr(w, 2), ' ' order by n)
       from regexp_split_to_table(
              regexp_replace(split_part(btrim(p_email), '@', 1), '\d+$', ''), '[._+-]+'
            ) with ordinality as t(w, n)
      where w <> ''),
    nullif(split_part(btrim(p_email), '@', 1), ''),
    'Unknown'
  ), 200)
$$;

create or replace function public.contact_name_rank(p_source text)
returns int language sql immutable as $$
  select case p_source when 'staff' then 3 when 'ticket' then 2 when 'sender' then 1 else 0 end
$$;

-- A name that came with an address (on a ticket, on an email): it becomes the
-- contact's name only if the one it has came from a weaker source. A "name"
-- that is an address is no name.
create or replace function public.offer_contact_name(
  p_contact uuid, p_name text, p_source text, p_email text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text := left(nullif(btrim(coalesce(p_name, '')), ''), 200);
begin
  if p_contact is null or v_name is null or v_name like '%@%' then
    return;
  end if;
  update public.contacts
     set name = v_name, name_source = p_source, name_email = lower(btrim(p_email))
   where id = p_contact
     and public.contact_name_rank(name_source) < public.contact_name_rank(p_source);
end $$;

-- Triggers and the functions below only.
revoke all on function public.offer_contact_name(uuid, text, text, text) from public, anon, authenticated;

-- ---------- reading and writing ----------
alter table public.contacts enable row level security;

drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

-- The browser may rename and annotate, nothing else: no insert or delete
-- (those are the trigger's and the function's), no moving a contact to
-- another project, and no saying where a name came from.
revoke all on public.contacts from anon;
revoke insert, update, delete on public.contacts from authenticated;
grant select on public.contacts to authenticated;
grant update (name, notes) on public.contacts to authenticated;

-- A rename the browser makes cannot touch `name_source`; every rename the
-- database makes changes it (a better source, by definition). So a name that
-- changes while its source does not was typed by staff.
create or replace function public.contacts_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.name  := nullif(btrim(coalesce(new.name, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  if new.name is null then
    raise exception 'A contact needs a name' using errcode = '23502';
  end if;
  -- (Naming a draft-era nameless one is the backfill, not staff.)
  if tg_op = 'UPDATE' and old.name is not null and new.name is distinct from old.name
     and new.name_source is not distinct from old.name_source then
    new.name_source := 'staff';
    new.name_email  := null;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop trigger if exists contacts_touch on public.contacts;
create trigger contacts_touch before insert or update on public.contacts
  for each row execute function public.contacts_touch();

-- ---------- a new address is a new contact ----------
-- AFTER INSERT, not before: remember_contact() inserts with ON CONFLICT, and a
-- before-trigger would run for an address that turns out to exist already,
-- leaving an empty contact behind. An after-trigger only sees rows that were
-- really inserted. Named from the address; whatever inserted it offers a
-- better name straight after.
create or replace function public.contact_for_new_address()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_contact uuid;
begin
  insert into public.contacts (project_id, name, name_source, name_email)
  values (new.project_id, public.name_from_email(new.email), 'email', new.email)
  returning id into v_contact;
  update public.project_contacts
     set contact_id = v_contact
   where project_id = new.project_id and email = new.email;
  return null;
end $$;

drop trigger if exists project_contacts_new_contact on public.project_contacts;
create trigger project_contacts_new_contact
  after insert on public.project_contacts
  for each row when (new.contact_id is null)
  execute function public.contact_for_new_address();

-- ---------- 0017's writers, now naming the contact ----------
-- Same signatures and callers as in 0017. A requester's name used to be kept
-- on the address, newest winning; it now goes to the address's contact under
-- the rule above — so a second ticket under another name no longer renames
-- someone, and staff's name always stands.
create or replace function public.remember_contact(
  p_project uuid, p_email text, p_name text default null, p_seen timestamptz default now()
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_contact uuid;
begin
  if p_project is null
     or v_email !~ '^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$' then
    return;
  end if;

  insert into public.project_contacts as c (project_id, email, last_seen_at)
  values (p_project, v_email, coalesce(p_seen, now()))
  on conflict (project_id, email) do update
    set last_seen_at = greatest(c.last_seen_at, excluded.last_seen_at);

  select contact_id into v_contact
    from public.project_contacts where project_id = p_project and email = v_email;
  perform public.offer_contact_name(v_contact, p_name, 'ticket', v_email);
end $$;

revoke all on function public.remember_contact(uuid, text, text, timestamptz) from public, anon, authenticated;

-- The display name on a customer's own email names their contact if nothing
-- better has. It still never adds an address (0017).
create or replace function public.remember_sender_name()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_contact uuid;
begin
  select c.contact_id into v_contact
    from public.project_contacts c
    join public.issues i on i.project_id = c.project_id
   where i.id = new.issue_id and c.email = lower(btrim(new.from_email));
  perform public.offer_contact_name(v_contact, new.from_name, 'sender', new.from_email);
  return null;
exception when others then
  -- The email is already filed; a name is never worth losing it over.
  return null;
end $$;

-- ---------- filing an address under a contact ----------
-- One function for "add an address to this contact" and "move this address
-- to that contact": either way the address ends up under `p_contact`. A null
-- `p_contact` puts it under a new contact of its own — splitting one out, or
-- saving someone who wrote in but was never kept.
--
-- `p_name` is the display name an unsaved sender wrote in under: it names a
-- contact made here, and is offered to the one it joins.
--
-- Returns the contact the address now belongs to.
create or replace function public.move_contact_email(
  p_project uuid, p_email text, p_contact uuid default null, p_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_known   boolean;
  v_from    uuid;
  v_target  uuid := p_contact;
  v_took    text;   -- the name the address gave the contact it leaves
  v_took_by text;   -- and where that name came from
begin
  if not public.is_project_member(p_project) then
    raise exception 'You are not a member of this project' using errcode = '42501';
  end if;
  -- Mirrors isEmail() in src/lib/email.js.
  if v_email !~ '^[^\s@<>(),;:]+@[^\s@<>(),;:]+\.[^\s@<>(),;:]+$' then
    raise exception '"%" is not an email address', p_email using errcode = '22023';
  end if;
  if v_target is not null and not exists (
    select 1 from public.contacts where id = v_target and project_id = p_project
  ) then
    raise exception 'That contact is not in this project' using errcode = '22023';
  end if;

  select true, contact_id into v_known, v_from
    from public.project_contacts
   where project_id = p_project and email = v_email
   for update;
  v_known := coalesce(v_known, false);

  if v_known and v_target is not null and v_from = v_target then
    return v_target;  -- already there
  end if;

  if v_from is not null then
    select name, name_source into v_took, v_took_by
      from public.contacts
     where id = v_from and name_email = v_email and name_source <> 'staff';
  end if;

  if v_target is null then
    insert into public.contacts (project_id, name, name_source, name_email)
    values (p_project, public.name_from_email(v_email), 'email', v_email)
    returning id into v_target;
  end if;
  -- What the address brings: an unsaved sender's display name, or the name
  -- it gave the contact it leaves.
  perform public.offer_contact_name(v_target, v_name, 'sender', v_email);
  perform public.offer_contact_name(v_target, v_took, v_took_by, v_email);

  if v_known then
    update public.project_contacts
       set contact_id = v_target
     where project_id = p_project and email = v_email;
  else
    insert into public.project_contacts (project_id, email, contact_id)
    values (p_project, v_email, v_target);
  end if;

  if v_from is not null then
    if not exists (select 1 from public.project_contacts where contact_id = v_from) then
      -- Its last address: the contact it left is folded into this one, so a
      -- contact never sits empty. The better-sourced name stays; the notes
      -- are kept, one after the other.
      update public.contacts t
         set name        = case when better then f.name else t.name end,
             name_source = case when better then f.name_source else t.name_source end,
             name_email  = case when better then f.name_email else t.name_email end,
             notes       = nullif(concat_ws(E'\n\n', t.notes, f.notes), '')
        from (
          select f.*, public.contact_name_rank(f.name_source)
                      > (select public.contact_name_rank(name_source) from public.contacts where id = v_target)
                      as better
            from public.contacts f where f.id = v_from
        ) f
       where t.id = v_target;
      delete from public.contacts where id = v_from;
    elsif v_took is not null then
      -- Its name went with the address: named afresh from the newest address
      -- it still has.
      update public.contacts c
         set name = public.name_from_email(a.email), name_source = 'email', name_email = a.email
        from (
          select email from public.project_contacts
           where contact_id = v_from order by last_seen_at desc limit 1
        ) a
       where c.id = v_from;
    end if;
  end if;

  return v_target;
end $$;

revoke all on function public.move_contact_email(uuid, text, uuid, text) from public, anon;
grant execute on function public.move_contact_email(uuid, text, uuid, text) to authenticated;

-- ---------- one-time backfill ----------
-- Every address already kept becomes a contact of its own, named with the
-- name the address had (from a ticket or an email — counted as a ticket's),
-- else one made from the address. Then that column goes: names live on
-- contacts only. PL/pgSQL plans each statement when it first runs, so the
-- branch reading `name` is never planned once the column is gone.
do $$
declare
  r record;
  v uuid;
  has_name boolean := exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'project_contacts' and column_name = 'name'
  );
begin
  if has_name then
    for r in select project_id, email, nullif(btrim(name), '') as name
               from public.project_contacts where contact_id is null loop
      insert into public.contacts (project_id, name, name_source, name_email)
      values (r.project_id, left(coalesce(r.name, public.name_from_email(r.email)), 200),
              case when r.name is null then 'email' else 'ticket' end, r.email)
      returning id into v;
      update public.project_contacts set contact_id = v
       where project_id = r.project_id and email = r.email;
    end loop;
    -- An earlier draft's contact left nameless takes its newest named
    -- address's name.
    update public.contacts c
       set name = s.name, name_source = 'ticket', name_email = s.email
      from (
        select distinct on (contact_id) contact_id, email, btrim(name) as name
          from public.project_contacts
         where contact_id is not null and nullif(btrim(name), '') is not null
         order by contact_id, last_seen_at desc
      ) s
     where c.id = s.contact_id and c.name is null;
  else
    for r in select project_id, email from public.project_contacts where contact_id is null loop
      insert into public.contacts (project_id, name, name_source, name_email)
      values (r.project_id, public.name_from_email(r.email), 'email', r.email)
      returning id into v;
      update public.project_contacts set contact_id = v
       where project_id = r.project_id and email = r.email;
    end loop;
  end if;

  -- Anything still nameless: from its newest address.
  update public.contacts c
     set name = public.name_from_email(s.email), name_source = 'email', name_email = s.email
    from (
      select distinct on (contact_id) contact_id, email
        from public.project_contacts
       where contact_id is not null
       order by contact_id, last_seen_at desc
    ) s
   where c.id = s.contact_id and c.name is null;
end $$;

-- A draft-era contact with no address at all cannot be named; it has nothing
-- to show either.
delete from public.contacts c
 where c.name is null
   and not exists (select 1 from public.project_contacts p where p.contact_id = c.id);

alter table public.contacts alter column name set not null;
alter table public.project_contacts drop column if exists name;

comment on column public.contacts.name_source is
  'Where the name came from: email (made from an address) < sender (an
   email''s display name) < ticket (a requester name) < staff (typed). Only a
   better source replaces a name.';
