-- ============================================================
-- 0004 — companies as a list, not free text
--
-- `issues.company` was a text box, so the same customer arrived as "Wilbert's
-- U-Pull-It", "Wilberts UPullIt" and "wupi" — three rows in every report. This
-- adds a `companies` table the forms pick from.
--
-- There is deliberately NO admin UI for it: companies are onboarded rarely and
-- by whoever runs the deployment, so the list is maintained in the Supabase
-- dashboard (or by SQL) with the service role. Hence a read policy and no write
-- policy at all — the anon key can list companies, and nothing more.
--
-- Two identifiers, for two jobs:
--   name — what people read and what `issues.company` keeps storing, so every
--          existing list, report, search and public page is unaffected.
--   code — short, lower case, stable. It is what an embed link carries
--          (?company=wupi) and what a ticket keeps in `company_code`, so a
--          company that is renamed does not split its own history.
--
-- Safe to re-run.
-- ============================================================

create table if not exists public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  -- Lower case and URL-safe: it travels in embed links.
  code       text not null unique
             check (code = lower(code) and code ~ '^[a-z0-9][a-z0-9_-]*$'),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.companies enable row level security;

-- Anyone may read: the public embed form has to render the picker.
drop policy if exists companies_read on public.companies;
create policy companies_read on public.companies for select to anon, authenticated using (true);
-- No insert/update/delete policy on purpose: the list is maintained with the
-- service role, from the Supabase dashboard.

alter table public.issues add column if not exists company_code text;

comment on column public.issues.company_code is
  'Code of the company this ticket belongs to, from `companies`. Survives a
   rename, unlike the display name kept in `company`. Null on tickets logged
   before the list existed, or with a company that is not on it.';

create index if not exists issues_company_code_idx on public.issues(company_code);

-- ---------- the two identifiers are kept agreeing ----------
-- A client may send either one. The database resolves whichever it got against
-- the list, so a ticket can never claim a code and an unrelated name — and a
-- company typed before the list existed is still left exactly as it was.
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
    new.company      := hit.name;   -- the code wins; the name follows it
    new.company_code := hit.code;
  end if;
  return new;
end $$;

drop trigger if exists issues_resolve_company on public.issues;
create trigger issues_resolve_company before insert or update of company, company_code
  on public.issues
  for each row execute function public.resolve_issue_company();

-- ---------- a starter company ----------
-- The internal form requires one, so a fresh install ships with an example to
-- rename or replace.
insert into public.companies (name, code) values ('BYOT Auto Parts', 'byotautoparts')
on conflict (code) do nothing;

insert into public.companies (name, code) values ('Nevada Pic-A-Part', 'nvpap')
on conflict (code) do nothing;

insert into public.companies (name, code) values ('Wilberts U-Pull It', 'wupi')
on conflict (code) do nothing;
