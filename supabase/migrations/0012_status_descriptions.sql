-- ============================================================
-- 0012 — status descriptions: what a status means, for customers
--
-- A status name is the team's shorthand ("Triaged", "On Hold"). The company
-- page (/tickets?company=…) groups a customer's tickets by status, and a
-- customer needs a sentence to know what each group means for them. That
-- sentence lives on the status row, edited under Configuration → Statuses.
--
-- `list_items` is readable with the anon key, which is fine here: the text is
-- written to be shown to customers. Optional — a status without one simply
-- shows no sentence — and only status rows carry it.
--
-- Safe to re-run.
-- ============================================================

alter table public.list_items add column if not exists description text;

comment on column public.list_items.description is
  'Status rows only: one customer-facing sentence on what the status means.
   Shown under the status heading on the public company page. Public: list_items
   is anon-readable.';

alter table public.list_items drop constraint if exists list_items_description_only_on_status;
alter table public.list_items add constraint list_items_description_only_on_status
  check (description is null or list_type = 'status');
