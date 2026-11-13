-- Resending an email that was not delivered.
--
-- Mailgun gives up on some messages for good (a full mailbox, a server that
-- refused it, a misconfiguration on our side since put right). Staff with the
-- email grant may send such a message again from its card: `email-send` sends
-- the same email — same recipients, text, signature and files — as a new
-- message in the same thread, and records which one it replaces here.
--
-- One resend per failed message: the unique index makes a second one
-- impossible, and the thread drops the button once a message has one. If the
-- resend fails too, it is itself a failed message and may be resent in turn.
--
-- Written only by `email-send` (service_role), like every other column here.

alter table public.email_messages
  add column if not exists resend_of uuid references public.email_messages(id) on delete set null;

create unique index if not exists email_messages_resend_of_idx
  on public.email_messages(resend_of) where resend_of is not null;

comment on column public.email_messages.resend_of is
  'The failed outbound message this one sends again. At most one resend per message.';
