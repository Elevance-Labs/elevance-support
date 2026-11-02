-- ============================================================
-- 0021 — links between tickets
--
-- The same problem often arrives more than once: two people at one company
-- each write in about it, or one person writes in twice through two channels.
-- Staff now link such tickets, so whoever works one can see the others.
--
-- A link has no direction. Linking A to B is the same fact as linking B to A,
-- so it is stored once, as an ordered pair (the smaller id first), and read
-- from either end — there is no second row to fall out of step with the first.
-- The trigger below puts the pair in order, so a client may send it either way
-- round; the check and the unique index then make a pair, in any order, one row.
--
-- A ticket may link to any number of others, in any project. Sight follows the
-- tickets: a link is visible, addable and removable only by someone who can see
-- both ends, so it never reveals a ticket in a project the reader is not in.
-- Any signed-in user may link or unlink — it is a note about the tickets, not
-- a change to either.
--
-- Staff only. No anon read, and deliberately absent from the `public-issue` and
-- `public-company` allow-lists: that a customer's request was linked to someone
-- else's is the team's knowledge, not theirs.
--
-- Safe to re-run.
-- ============================================================

create table if not exists public.issue_links (
  issue_a    uuid not null references public.issues(id) on delete cascade,
  issue_b    uuid not null references public.issues(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (issue_a, issue_b),
  -- One row per pair, and never a ticket linked to itself.
  check (issue_a < issue_b)
);
-- The primary key finds a ticket's links where it is the smaller id; this finds
-- the rest.
create index if not exists issue_links_b_idx on public.issue_links(issue_b);

comment on table public.issue_links is
  'Undirected links between tickets, one row per pair (issue_a < issue_b).
   Visible and writable only to someone who can see both tickets.';

-- ---------- the pair, in order ----------
-- Swapped rather than refused, so "link this to that" works whichever ticket
-- the request came from. A ticket linked to itself is left as it is, for the
-- check to refuse.
create or replace function public.order_issue_link()
returns trigger language plpgsql set search_path = public as $$
declare
  t uuid;
begin
  if new.issue_a > new.issue_b then
    t := new.issue_a; new.issue_a := new.issue_b; new.issue_b := t;
  end if;
  -- Whoever links it, as far as the browser is concerned: it may not credit
  -- someone else.
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists issue_links_order on public.issue_links;
create trigger issue_links_order before insert on public.issue_links
  for each row execute function public.order_issue_link();

-- ---------- who sees and changes them ----------
alter table public.issue_links enable row level security;

drop policy if exists issue_links_read on public.issue_links;
create policy issue_links_read on public.issue_links for select to authenticated
  using (public.can_see_issue(issue_a) and public.can_see_issue(issue_b));

drop policy if exists issue_links_insert on public.issue_links;
create policy issue_links_insert on public.issue_links for insert to authenticated
  with check (public.can_see_issue(issue_a) and public.can_see_issue(issue_b));

-- No update: a link is made or unmade, never re-pointed.
drop policy if exists issue_links_delete on public.issue_links;
create policy issue_links_delete on public.issue_links for delete to authenticated
  using (public.can_see_issue(issue_a) and public.can_see_issue(issue_b));
