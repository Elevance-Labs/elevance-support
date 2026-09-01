-- ============================================================
-- 0003 — where a request came from
--
-- Tickets arrive through the public form, but also by email, chat, SMS, a phone
-- call, or from inside the team. Until now that was only ever visible in the
-- description, so it could not be reported on. This adds `issues.source`, backed
-- by a new `source` configuration list so the channels stay editable.
--
-- `Form` is not one of the choices staff get: it means "came through the public
-- embed form", which is something only the database can know. The trigger below
-- makes that true rather than trusting the client — an anonymous insert is
-- always stamped `Form`, and a signed-in one may not claim it.
--
-- The same trigger pins an anonymous submission's `submitted_date` to now.
-- Staff may back-date a ticket they are logging on a customer's behalf (the call
-- happened this morning), but a public submission happens when it arrives, and
-- the anon key is public.
--
-- Safe to re-run.
-- ============================================================

-- ---------- the list gains a type ----------
alter table public.list_items drop constraint if exists list_items_list_type_check;
alter table public.list_items add constraint list_items_list_type_check
  check (list_type in ('type','product','area','priority','status','labels','source'));

insert into public.list_items (list_type, name, color, status_type, sla_hours, sort_order) values
  ('source','Form',     '#1976d2', null, null, 1),
  ('source','Email',    '#7b1fa2', null, null, 2),
  ('source','IM',       '#0288d1', null, null, 3),
  ('source','SMS',      '#388e3c', null, null, 4),
  ('source','Call',     '#f57c00', null, null, 5),
  ('source','Internal', '#616161', null, null, 6)
on conflict (list_type, name) do nothing;

-- ---------- the column ----------
alter table public.issues add column if not exists source text;

comment on column public.issues.source is
  'Channel the request arrived through — a name from the `source` list. Always
   `Form` for a submission through the public embed form, which the client
   cannot claim for itself.';

create index if not exists issues_source_idx on public.issues(source);

-- ---------- who may say `Form` ----------
create or replace function public.stamp_issue_origin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- The public form, or the service role acting for it.
    new.source         := 'Form';
    new.submitted_date := now();
  else
    if new.source = 'Form' then
      raise exception '`Form` is reserved for requests submitted through the public form';
    end if;
    -- A ticket cannot have been submitted after it was logged.
    if new.submitted_date is null or new.submitted_date > now() then
      new.submitted_date := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists issues_stamp_origin on public.issues;
create trigger issues_stamp_origin before insert on public.issues
  for each row execute function public.stamp_issue_origin();
