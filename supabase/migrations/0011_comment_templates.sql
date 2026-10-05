-- ============================================================
-- 0011 — comment templates: canned text for the comment box
--
-- A template is a title and a body. Staff pick one under the comment box and
-- its body is written into the box; nothing is posted until they post it, so
-- the template is a starting point, never a comment of its own.
--
-- Its own table rather than another `list_items` type, because `list_items` is
-- readable with the anon key — the public form needs its dropdowns — and the
-- team's canned replies are not the public's business. Here only a signed-in
-- user may read, and only an admin may write (Configuration → Templates), the
-- same split as every other configuration list.
--
-- Safe to re-run.
-- ============================================================

create table if not exists public.comment_templates (
  id         uuid primary key default gen_random_uuid(),
  title      text not null unique check (nullif(btrim(title), '') is not null),
  body       text not null check (nullif(btrim(body), '') is not null),
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.comment_templates is
  'Canned comment text. Picking one writes its body into the comment box; the
   author still edits and posts it themselves. Staff-only: no anon read.';

alter table public.comment_templates enable row level security;

drop policy if exists comment_templates_read on public.comment_templates;
create policy comment_templates_read on public.comment_templates
  for select to authenticated using (true);

drop policy if exists comment_templates_admin_write on public.comment_templates;
create policy comment_templates_admin_write on public.comment_templates
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
