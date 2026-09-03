-- ============================================================
-- Support Tool — Supabase schema
--
-- The complete database: tables, triggers, row level security, the storage
-- bucket and the starter configuration. Run this whole file in the Supabase
-- SQL editor on a fresh project.
--
-- This is the baseline as of go-live. Every change from here on goes in
-- supabase/migrations/ as its own file; this file is not edited in place
-- except to fold in a migration that has already shipped everywhere.
--
-- Written to be safe to re-run: everything is `if not exists` / `or replace`,
-- and the seed data is upserted rather than inserted blindly.
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- Tables
-- ============================================================

-- ---------- profiles (app users; mirrors auth.users) ----------
-- Roles are global: being added to a project grants access to it, and your
-- role decides what you may do once you are in — the same way in every project.
-- Disabled accounts simply cannot sign in.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text not null,
  role        text not null default 'member' check (role in ('admin','manager','member')),
  is_active   boolean not null default true,
  -- Public URL of the profile photo in the `avatars` bucket, or null. The photo
  -- is the one thing on a profile its owner may change themselves.
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- ---------- projects ----------
-- A project owns its tickets, its members and its own ticket numbering. Every
-- issue belongs to exactly one, and nobody ever looks at two at once.
--
-- `key` is the 3–4 letter code that prefixes every ticket in the project and
-- appears in its embed and share URLs. It is unique, upper case, and immutable
-- once the project exists — see freeze_project_key() below.
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  key        text not null unique check (key ~ '^[A-Z]{3,4}$'),
  status     text not null default 'incoming' check (status in ('incoming','in_progress','closed')),
  -- The project's own ticket counter. Handed out one at a time by
  -- next_issue_number(), so tickets read ACME-1, ACME-2, ACME-3.
  issue_seq  bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members(user_id);

-- ---------- configuration lists ----------
-- One table drives every configurable dropdown.
--
-- `status_type` applies to status rows only: it is what the workflow rules and
-- the SLA clock actually read, so a status is free to be named anything.
-- `sla_hours` applies to request types.
create table if not exists public.list_items (
  id          uuid primary key default gen_random_uuid(),
  list_type   text not null check (list_type in ('type','product','area','priority','status','labels','source')),
  name        text not null,
  color       text,
  status_type text check (status_type is null or status_type in ('new','in_progress','paused','closed')),
  sla_hours   numeric check (sla_hours is null or sla_hours > 0),
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (list_type, name),
  -- A status row must declare its type; other list types never use the column.
  constraint list_items_status_needs_type
    check (list_type <> 'status' or status_type is not null)
);

-- ---------- companies ----------
-- Who the ticket is for. A list rather than a text box, so one customer is one
-- row in every report. Maintained with the service role (Supabase dashboard) —
-- there is no admin UI and no write policy.
--
-- `name` is what everyone reads and what `issues.company` stores; `code` is the
-- short, stable identifier an embed link carries (?company=wupi).
create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  code       text not null unique
             check (code = lower(code) and code ~ '^[a-z0-9][a-z0-9_-]*$'),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- issues ----------
create table if not exists public.issues (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id),
  -- Ticket number within its project, allocated by next_issue_number().
  -- Public: it names the ticket (ACME-42) and addresses its share link
  -- (/i/ACME/42), so it is never reassigned once given out.
  number          bigint not null,
  -- request details
  type            text,
  product         text,
  area            text,
  priority        text,
  -- issue details
  title           text not null,
  description     text,
  -- submission details
  company         text,
  -- Code of the company row above; survives a rename, unlike the display name.
  company_code    text,
  requester_name  text,
  requester_email text,
  source_url      text,
  -- Channel the request arrived through — a name from the `source` list.
  -- Always 'Form' for the public embed form; stamp_issue_origin() makes that
  -- true rather than trusting the client.
  source          text,
  -- internal
  submitted_date  timestamptz not null default now(),
  status          text not null default 'New',
  assignee_id     uuid references public.profiles(id) on delete set null,
  labels          text[] not null default '{}',
  jira_ticket     text,
  notes           text,
  -- SLA clock: stopped for good at closed_at, suspended while paused.
  -- paused_ms   : milliseconds already spent paused, across all pauses
  -- paused_since: when the current pause began, null when not paused
  closed_at       timestamptz,
  paused_ms       bigint not null default 0,
  paused_since    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists issues_status_idx    on public.issues(status);
create index if not exists issues_assignee_idx  on public.issues(assignee_id);
create index if not exists issues_submitted_idx on public.issues(submitted_date desc);
create index if not exists issues_project_idx   on public.issues(project_id);
create index if not exists issues_source_idx    on public.issues(source);
create index if not exists issues_company_code_idx on public.issues(company_code);
-- Also the lookup behind a share link: /i/{key}/{number} resolves through this.
create unique index if not exists issues_project_number_idx on public.issues(project_id, number);

-- ---------- attachments ----------
create table if not exists public.attachments (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references public.issues(id) on delete cascade,
  file_name  text not null,
  file_path  text not null,          -- path inside the `attachments` storage bucket
  mime_type  text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index if not exists attachments_issue_idx on public.attachments(issue_id);

-- ---------- comments ----------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  issue_id   uuid not null references public.issues(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists comments_issue_idx on public.comments(issue_id, created_at);

-- ---------- status timeline ----------
create table if not exists public.status_events (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references public.issues(id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists status_events_issue_idx on public.status_events(issue_id, created_at);

-- ---------- saved views (filter presets) ----------
create table if not exists public.views (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  filters    jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Role helpers
-- ============================================================
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin';
$$;

-- managers inherit everything a manager-or-above can do
create or replace function public.is_manager_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin','manager');
$$;

/*
 * Membership is what grants sight of a project's tickets.
 *
 * Admins are exempt: they manage projects, so they can always see one — being
 * able to create a project you then cannot open would be a trap. Every other
 * role, manager included, sees only the projects it has been added to.
 */
create or replace function public.is_project_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_project is not null and (
    public.is_admin()
    or exists (
      select 1 from public.project_members m
      where m.project_id = p_project and m.user_id = auth.uid()
    )
  );
$$;

create or replace function public.can_see_issue(p_issue uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.issues i
    where i.id = p_issue and public.is_project_member(i.project_id)
  );
$$;

-- ============================================================
-- Accounts
-- ============================================================

-- "jane.doe@acme.com" -> "Jane Doe". Accounts created straight from the
-- Supabase dashboard arrive with no full_name, and the UI has nothing to show
-- but the email address unless we derive one.
create or replace function public.name_from_email(addr text)
returns text language sql immutable as $$
  select nullif(
    initcap(
      regexp_replace(
        regexp_replace(split_part(coalesce(addr, ''), '@', 1), '\d+$', ''),
        '[._+-]+', ' ', 'g'
      )
    ),
    ''
  );
$$;

-- ---------- auto-create a profile for every new auth user ----------
-- Without this, a user created from the Supabase dashboard can sign in but has
-- no profiles row — so is_admin() is false, and the Users and Configuration
-- pages silently disappear from the nav with no explanation.
--
-- The very first account to exist becomes an admin, which solves the
-- chicken-and-egg problem of needing an admin before you can create users.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
  supplied text;
begin
  select count(*) = 0 into is_first from public.profiles;
  supplied := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(supplied, ''), public.name_from_email(new.email), new.email),
    case when is_first then 'admin' else 'member' end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Shared triggers
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists issues_touch on public.issues;
create trigger issues_touch before update on public.issues
  for each row execute function public.touch_updated_at();

drop trigger if exists comments_touch on public.comments;
create trigger comments_touch before update on public.comments
  for each row execute function public.touch_updated_at();

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Projects: immutable keys and per-project ticket numbering
-- ============================================================

-- The key is a public identifier: it is baked into embed snippets customers
-- have pasted into their own pages and into share links already sent out.
-- Renaming a project is fine; re-keying one would break both.
create or replace function public.freeze_project_key()
returns trigger language plpgsql as $$
begin
  if new.key is distinct from old.key then
    raise exception 'A project key cannot be changed once the project exists (% -> %)',
      old.key, new.key
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists projects_freeze_key on public.projects;
create trigger projects_freeze_key before update on public.projects
  for each row execute function public.freeze_project_key();

/*
 * Allocate the next number in a project.
 *
 * The UPDATE ... RETURNING takes a row lock on the project, so two tickets
 * submitted at the same instant cannot be handed the same number. Runs as
 * security definer because the public intake form inserts as `anon`, which has
 * no business updating a project row for any other reason.
 */
create or replace function public.next_issue_number(p_project uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  n bigint;
begin
  update public.projects
  set issue_seq = issue_seq + 1
  where id = p_project
  returning issue_seq into n;

  if n is null then
    raise exception 'Unknown project %', p_project using errcode = 'foreign_key_violation';
  end if;
  return n;
end $$;

create or replace function public.assign_issue_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is null then
    raise exception 'Every ticket must belong to a project'
      using errcode = 'not_null_violation';
  end if;
  if new.number is null then
    new.number := public.next_issue_number(new.project_id);
  end if;
  return new;
end $$;

drop trigger if exists issues_assign_number on public.issues;
create trigger issues_assign_number before insert on public.issues
  for each row execute function public.assign_issue_number();

-- A ticket stays in the project it was filed against: its number, its share
-- link and its embed origin all belong to that project.
create or replace function public.freeze_issue_project()
returns trigger language plpgsql as $$
begin
  if old.project_id is not null and new.project_id is distinct from old.project_id then
    raise exception 'A ticket cannot be moved between projects'
      using errcode = 'check_violation';
  end if;
  if old.number is not null and new.number is distinct from old.number then
    raise exception 'A ticket number cannot be changed'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists issues_freeze_project on public.issues;
create trigger issues_freeze_project before update on public.issues
  for each row execute function public.freeze_issue_project();

-- ============================================================
-- Statuses: defaults, transition rules and the SLA clock
--
-- Doing this in the database means the public intake form and the dashboard
-- both get it for free.
-- ============================================================

create or replace function public.status_type_of(status_name text)
returns text language sql stable security definer set search_path = public as $$
  select status_type from public.list_items
  where list_type = 'status' and name = status_name
  limit 1;
$$;

-- new(0) -> in_progress(1) -> closed(2). Paused has no rank: it is a
-- suspension of whatever the ticket was doing, not a step in the workflow.
create or replace function public.status_rank(st text)
returns int language sql immutable as $$
  select case st when 'new' then 0 when 'in_progress' then 1 when 'closed' then 2 end;
$$;

/*
 * The status type a ticket is "really" in — that is, ignoring any pause.
 * Looks back through the timeline for the most recent status that was not of
 * type paused. Used so that pausing can never be a way to move backwards:
 * a ticket paused while In Progress still cannot return to New.
 */
create or replace function public.effective_status_type(p_issue uuid, p_current text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  t text;
begin
  t := public.status_type_of(p_current);
  if t is distinct from 'paused' then
    return t;
  end if;

  select public.status_type_of(e.to_status) into t
  from public.status_events e
  where e.issue_id = p_issue
    and public.status_type_of(e.to_status) is distinct from 'paused'
  order by e.created_at desc, e.id desc
  limit 1;

  return coalesce(t, 'new');
end $$;

-- ---------- new tickets start at the first "new" status ----------
create or replace function public.default_issue_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  first_status text;
begin
  if new.status is null or new.status = '' then
    select name into first_status
    from public.list_items
    where list_type = 'status' and is_active and status_type = 'new'
    order by sort_order, name
    limit 1;

    -- fall back to the first active status of any type
    if first_status is null then
      select name into first_status
      from public.list_items
      where list_type = 'status' and is_active
      order by sort_order, name
      limit 1;
    end if;

    new.status := coalesce(first_status, 'New');
  end if;
  return new;
end $$;

drop trigger if exists issues_default_status on public.issues;
create trigger issues_default_status before insert on public.issues
  for each row execute function public.default_issue_status();

-- ---------- where a ticket came from ----------
-- 'Form' means "arrived through the public embed form", which only the database
-- can know: an anonymous insert is stamped with it, and a signed-in one may not
-- claim it. The same rule pins an anonymous submission's date to now — staff may
-- back-date a ticket they are logging for a customer, the public form may not.
create or replace function public.stamp_issue_origin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    new.source         := 'Form';
    new.submitted_date := now();
  else
    if new.source = 'Form' then
      raise exception '`Form` is reserved for requests submitted through the public form';
    end if;
    if new.submitted_date is null or new.submitted_date > now() then
      new.submitted_date := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists issues_stamp_origin on public.issues;
create trigger issues_stamp_origin before insert on public.issues
  for each row execute function public.stamp_issue_origin();

-- ---------- which company a ticket belongs to ----------
-- A client may send the name or the code. Whichever arrives is resolved against
-- `companies`, so the two can never disagree; a company typed before the list
-- existed is left exactly as it was.
create or replace function public.resolve_issue_company()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  hit public.companies%rowtype;
begin
  if new.company_code is not null and new.company_code <> '' then
    select * into hit from public.companies where code = lower(new.company_code);
  elsif new.company is not null and new.company <> '' then
    select * into hit from public.companies where lower(name) = lower(new.company);
  end if;

  if hit.id is not null then
    new.company      := hit.name;
    new.company_code := hit.code;
  end if;
  return new;
end $$;

drop trigger if exists issues_resolve_company on public.issues;
create trigger issues_resolve_company before insert or update of company, company_code
  on public.issues
  for each row execute function public.resolve_issue_company();

-- ---------- transition rules, pause clock and closed clock ----------
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
    elsif public.status_rank(new_type) < public.status_rank(eff_type) then
      raise exception
        'Cannot move a ticket from % (%) back to % (%)',
        old.status, eff_type, new.status, new_type
        using errcode = 'check_violation';
    end if;
  end if;

  -- Request fields are only editable by an admin or manager, and only while
  -- the ticket is still in a "new" status. They follow the effective type, so
  -- pausing a new ticket does not quietly lock them.
  if (new.type    is distinct from old.type
   or new.product is distinct from old.product
   or new.area    is distinct from old.area) then
    if eff_type is distinct from 'new' then
      raise exception
        'Request fields can only be changed while the ticket is in a New status'
        using errcode = 'check_violation';
    end if;
    if actor_role is null or actor_role not in ('admin','manager') then
      raise exception
        'Only an admin or manager can change the request fields'
        using errcode = 'check_violation';
    end if;
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

-- A ticket created straight into a closed or paused status gets its clock set.
create or replace function public.set_closed_at_on_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t text;
begin
  t := public.status_type_of(new.status);
  if t = 'closed' then
    new.closed_at := coalesce(new.closed_at, now());
  elsif t = 'paused' then
    new.paused_since := coalesce(new.paused_since, now());
  end if;
  return new;
end $$;

drop trigger if exists issues_closed_at_insert on public.issues;
create trigger issues_closed_at_insert before insert on public.issues
  for each row execute function public.set_closed_at_on_insert();

-- ---------- every status change is recorded on the timeline ----------
create or replace function public.log_status_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.status_events (issue_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.status_events (issue_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists issues_log_status on public.issues;
create trigger issues_log_status after insert or update of status on public.issues
  for each row execute function public.log_status_event();

-- ============================================================
-- Row level security
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.list_items      enable row level security;
alter table public.companies       enable row level security;
alter table public.issues          enable row level security;
alter table public.attachments     enable row level security;
alter table public.comments        enable row level security;
alter table public.status_events   enable row level security;
alter table public.views           enable row level security;

-- ---------- profiles ----------
-- Any signed-in user can read the roster. Admins have full control; managers
-- may update non-admin rows only (used for disabling accounts). Nobody but an
-- admin changes roles — that is enforced in the admin-users edge function,
-- which is the only writer of `role`.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_manager_update on public.profiles;
create policy profiles_manager_update on public.profiles for update to authenticated
  using (public.my_role() = 'manager' and role in ('manager','member'))
  with check (public.my_role() = 'manager' and role in ('manager','member'));

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- `profiles_self_update` exists so you can save your own avatar. It must not
-- become a self-promotion: role, is_active and email are pinned back to their
-- old values whenever you write your own row and you are not an admin. The
-- admin-users function runs as `service_role` (auth.uid() is null) and is
-- unaffected.
create or replace function public.profiles_freeze_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and not public.is_admin() then
    new.role      := old.role;
    new.is_active := old.is_active;
    new.email     := old.email;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_freeze_privileged on public.profiles;
create trigger profiles_freeze_privileged
  before update on public.profiles
  for each row execute function public.profiles_freeze_privileged_fields();

-- ---------- projects ----------
-- The public intake form has to resolve /embed/{key}/form before anyone has
-- signed in, so `anon` may read the project list. This exposes project names
-- and keys and nothing else — the same stance already taken for the
-- configuration lists that fill the form's dropdowns.
drop policy if exists projects_read on public.projects;
create policy projects_read on public.projects
  for select to anon, authenticated using (true);

drop policy if exists projects_admin_write on public.projects;
create policy projects_admin_write on public.projects for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Members can see who else is on a project they belong to; only admins edit.
drop policy if exists project_members_read on public.project_members;
create policy project_members_read on public.project_members
  for select to authenticated
  using (public.is_admin() or user_id = auth.uid() or public.is_project_member(project_id));

drop policy if exists project_members_admin_write on public.project_members;
create policy project_members_admin_write on public.project_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- list_items: public form needs to read them; only admins write ----------
drop policy if exists lists_read on public.list_items;
create policy lists_read on public.list_items for select to anon, authenticated using (true);

drop policy if exists lists_admin_write on public.list_items;
create policy lists_admin_write on public.list_items for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- companies: everyone reads, nobody writes from a browser ----------
-- The public form has to render the picker, so `anon` may read. There is no
-- write policy at all: the list is maintained with the service role.
drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies for select to anon, authenticated using (true);

-- ---------- issues ----------
-- ANYONE may submit (public embed form); staff read and update only the
-- tickets of projects they are a member of.
--
-- No anon read policy on purpose. The public share page is served by the
-- `public-issue` edge function, which reads with the service role and returns
-- only the handful of fields a customer may see. Opening `issues` to `anon`
-- would expose every column of every ticket to anyone holding the anon key.
drop policy if exists issues_public_insert on public.issues;
create policy issues_public_insert on public.issues for insert to anon, authenticated with check (true);

drop policy if exists issues_staff_read on public.issues;
create policy issues_staff_read on public.issues for select to authenticated
  using (public.is_project_member(project_id));

drop policy if exists issues_staff_update on public.issues;
create policy issues_staff_update on public.issues for update to authenticated
  using (public.is_project_member(project_id))
  with check (public.is_project_member(project_id));

drop policy if exists issues_admin_delete on public.issues;
create policy issues_admin_delete on public.issues for delete to authenticated
  using (public.is_admin() and public.is_project_member(project_id));

-- ---------- attachments: public may attach on submit; staff read ----------
drop policy if exists att_public_insert on public.attachments;
create policy att_public_insert on public.attachments for insert to anon, authenticated with check (true);

drop policy if exists att_staff_read on public.attachments;
create policy att_staff_read on public.attachments for select to authenticated
  using (public.can_see_issue(issue_id));

drop policy if exists att_staff_delete on public.attachments;
create policy att_staff_delete on public.attachments for delete to authenticated
  using (public.can_see_issue(issue_id));

-- ---------- comments ----------
-- Everyone who can see the ticket reads and posts; authors may edit/delete
-- their own for 5 minutes only. The time limit is enforced here, not just in
-- the UI, so it can't be bypassed by calling the API directly.
drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments for select to authenticated
  using (public.can_see_issue(issue_id));

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = auth.uid() and public.can_see_issue(issue_id));

drop policy if exists comments_update_own on public.comments;
create policy comments_update_own on public.comments
  for update to authenticated
  using (author_id = auth.uid() and created_at > now() - interval '5 minutes')
  with check (author_id = auth.uid() and created_at > now() - interval '5 minutes');

drop policy if exists comments_delete_own on public.comments;
create policy comments_delete_own on public.comments
  for delete to authenticated
  using (author_id = auth.uid() and created_at > now() - interval '5 minutes');

-- ---------- status events: written by triggers, read with the ticket ----------
drop policy if exists status_events_read on public.status_events;
create policy status_events_read on public.status_events for select to authenticated
  using (public.can_see_issue(issue_id));

-- ---------- views: everyone signed in reads; admins and managers manage ----------
drop policy if exists views_read on public.views;
create policy views_read on public.views for select to authenticated using (true);

drop policy if exists views_admin_write on public.views;
drop policy if exists views_manage on public.views;
create policy views_manage on public.views for all to authenticated
  using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());

-- ============================================================
-- Storage bucket for attachments
-- ============================================================
-- One limit for the whole bucket, so it is the largest thing allowed through it
-- (30MB, for a screen recording). The per-type rule — 10MB for an image or PDF,
-- 30MB only for video — is enforced by the form.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 31457280,
        array['image/png','image/jpeg','image/gif','image/webp','application/pdf',
              'video/mp4','video/webm','video/quicktime'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists att_upload on storage.objects;
create policy att_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'attachments');
drop policy if exists att_download on storage.objects;
create policy att_download on storage.objects for select to authenticated
  using (bucket_id = 'attachments');
drop policy if exists att_remove on storage.objects;
create policy att_remove on storage.objects for delete to authenticated
  using (bucket_id = 'attachments');

-- ============================================================
-- Storage bucket for profile photos
--
-- Public, unlike `attachments`: an avatar is shown in every header and comment
-- row, so signing a URL per render would be a lot of round trips for a photo
-- its owner chose to show colleagues. Writes stay owner-only — the first folder
-- of the object name must be the caller's uid.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatar_read on storage.objects;
create policy avatar_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
drop policy if exists avatar_upload on storage.objects;
create policy avatar_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars'
              and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatar_update on storage.objects;
create policy avatar_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars'
         and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars'
              and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatar_remove on storage.objects;
create policy avatar_remove on storage.objects for delete to authenticated
  using (bucket_id = 'avatars'
         and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- Seed the configuration lists
--
-- Statuses are coloured by their status type in the UI (New grey, In Progress
-- blue, Paused orange, Closed green), so status rows carry no colour of their
-- own. Everything here is editable on the Configuration page afterwards.
-- ============================================================
insert into public.list_items (list_type, name, color, status_type, sla_hours, sort_order) values
  ('type','Bug',             '#d32f2f', null, 8,  1),
  ('type','Feature Request', '#1976d2', null, 72, 2),
  ('type','Question',        '#7b1fa2', null, 24, 3),
  ('type','Data Issue',      '#f57c00', null, 24, 4),
  ('priority','Urgent', '#d32f2f', null, null, 1),
  ('priority','High',   '#f57c00', null, null, 2),
  ('priority','Medium', '#fbc02d', null, null, 3),
  ('priority','Low',    '#388e3c', null, null, 4),
  ('status','New',         null, 'new',         null, 1),
  ('status','Triaged',     null, 'in_progress', null, 2),
  ('status','In Progress', null, 'in_progress', null, 3),
  ('status','Blocked',     null, 'paused',      null, 4),
  ('status','Done',        null, 'closed',      null, 5),
  ('product','Core Platform', null, null, null, 1),
  ('product','Mobile App',    null, null, null, 2),
  ('area','Billing',    null, null, null, 1),
  ('area','Reporting',  null, null, null, 2),
  ('area','Onboarding', null, null, null, 3),
  ('labels','regression',          '#d32f2f', null, null, 1),
  ('labels','customer-escalation', '#f57c00', null, null, 2),
  ('labels','quick-win',           '#388e3c', null, null, 3),
  -- 'Form' is stamped by the database, never chosen by staff.
  ('source','Form',     '#1976d2', null, null, 1),
  ('source','Email',    '#7b1fa2', null, null, 2),
  ('source','IM',       '#0288d1', null, null, 3),
  ('source','SMS',      '#388e3c', null, null, 4),
  ('source','Call',     '#f57c00', null, null, 5),
  ('source','Internal', '#616161', null, null, 6)
on conflict (list_type, name) do nothing;

-- ---------- a starter project ----------
-- Every ticket needs a project, so a fresh install ships with one that works
-- out of the box. Rename it on the Projects page; the key cannot be changed,
-- so create your own project instead if you want a different prefix.
insert into public.projects (name, key, status)
values ('Support', 'SUP', 'in_progress')
on conflict (name) do nothing;

-- ---------- a starter company ----------
-- The internal form requires one, so a fresh install ships with an example to
-- rename or replace. Companies are maintained here or in the dashboard.
insert into public.companies (name, code)
values ('Example Customer', 'example')
on conflict (code) do nothing;
