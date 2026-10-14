-- ============================================================
-- 0014 — rich text email, and a signature per person
--
-- The Conversation tab's box now takes bold, italic, underline, lists and
-- links. What it sends is not HTML: it is a small document (paragraphs and
-- lists of runs of text, see src/lib/richText.js), which `email-send` checks
-- again and builds the email's HTML from, escaping every piece. So the
-- browser has no way to put markup of its own into a customer's inbox.
--
--   * email_messages.body_doc — that document, for an outbound message, as it
--     went: the body and the signature it was sent with. The thread draws it
--     with React, never as HTML. Null on inbound mail (shown as text) and on
--     anything sent before this.
--
--   * profiles.email_signature — the sender's signature in the same format,
--     or null for none. Optional and the person's own: written from /profile
--     under `profiles_self_update`, and deliberately not among the fields
--     profiles_freeze_privileged_fields() pins. `email-send` reads it from the
--     sender's row and appends it itself — the browser never sends one.
--     Readable by everyone signed in, like the rest of the roster; it goes to
--     customers on every email, so nothing private belongs in it.
--
-- Safe to re-run.
-- ============================================================

alter table public.email_messages add column if not exists body_doc jsonb;

alter table public.profiles add column if not exists email_signature jsonb;

-- A document is an object with a blocks array; anything else is not one.
alter table public.profiles drop constraint if exists profiles_email_signature_shape;
alter table public.profiles add constraint profiles_email_signature_shape
  check (email_signature is null
         or (jsonb_typeof(email_signature) = 'object'
             and jsonb_typeof(email_signature -> 'blocks') = 'array'
             and pg_column_size(email_signature) < 20000));
