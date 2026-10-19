-- ============================================================
-- 0018 — rich text comments and templates; managers manage labels and templates
--
--   * comments.body_doc, comment_templates.body_doc — the rich text document
--     (src/lib/richText.js, the same format as an email's body_doc) the comment
--     or template was written as. `body` stays, and stays required: it is the
--     document's plain text, written beside it by the browser, and what anything
--     that does not draw rich text reads. Null on rows written before this —
--     they are plain text, and are drawn and edited as such. Neither is ever
--     rendered as HTML; the app draws the document with React.
--
--   * list_items — a manager may now write `labels` rows (and only those).
--     Labels describe how the team files its own work; types, statuses,
--     severities and the rest drive transitions, SLAs and the public form, so
--     they stay an admin's. The USING and WITH CHECK both pin the type, so a
--     manager can neither touch another list nor turn a label into one.
--
--   * comment_templates — admins and managers write. Still signed-in read only.
--
-- Mirrors can.manageList / can.manageTemplates in src/lib/permissions.js.
--
-- Safe to re-run.
-- ============================================================

alter table public.comments          add column if not exists body_doc jsonb;
alter table public.comment_templates add column if not exists body_doc jsonb;

-- A document is an object with a blocks array; anything else is not one.
alter table public.comments drop constraint if exists comments_body_doc_shape;
alter table public.comments add constraint comments_body_doc_shape
  check (body_doc is null
         or (jsonb_typeof(body_doc) = 'object'
             and jsonb_typeof(body_doc -> 'blocks') = 'array'
             and pg_column_size(body_doc) < 200000));

alter table public.comment_templates drop constraint if exists comment_templates_body_doc_shape;
alter table public.comment_templates add constraint comment_templates_body_doc_shape
  check (body_doc is null
         or (jsonb_typeof(body_doc) = 'object'
             and jsonb_typeof(body_doc -> 'blocks') = 'array'
             and pg_column_size(body_doc) < 200000));

comment on column public.comments.body_doc is
  'Rich text document (src/lib/richText.js). body is its plain text. Null on
   comments written before rich text: those are plain body only.';
comment on column public.comment_templates.body_doc is
  'Rich text document (src/lib/richText.js). body is its plain text. Null on
   templates written before rich text: those are plain body only.';

-- ---------- list_items: managers write labels ----------
-- Permissive policies OR together, so lists_admin_write still covers admins.
drop policy if exists lists_manager_labels_write on public.list_items;
create policy lists_manager_labels_write on public.list_items
  for all to authenticated
  using (public.is_manager_or_admin() and list_type = 'labels')
  with check (public.is_manager_or_admin() and list_type = 'labels');

-- ---------- comment_templates: admins and managers write ----------
drop policy if exists comment_templates_admin_write on public.comment_templates;
drop policy if exists comment_templates_staff_write on public.comment_templates;
create policy comment_templates_staff_write on public.comment_templates
  for all to authenticated
  using (public.is_manager_or_admin()) with check (public.is_manager_or_admin());
