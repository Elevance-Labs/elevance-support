-- ============================================================
-- 0022 — sign in with Google; only accounts an admin added
--
-- Staff now sign in with Google instead of a password. Nobody gets a new
-- account for it: Supabase attaches a Google identity to the existing auth
-- user with the same email, so `profiles.id` — which every ticket, comment,
-- project membership and schedule points at — does not change.
--
-- That only holds while a Google address finds its account. One that finds
-- none used to be given a fresh auth user, and `handle_new_user` wrote it a
-- member profile: an empty account for a colleague whose login email is
-- spelled differently, and an account of any kind for a stranger. So a new
-- auth user is now refused unless an admin asked for it:
--
--   * `account_invites` holds the emails `admin-users` is about to create.
--     Service role only — no grants, no policies.
--   * `handle_new_user` takes the invite and writes the profile, or raises.
--     The very first account is still let in, and still becomes the admin.
--
-- Accounts added in the Supabase dashboard are refused too (after the first):
-- add people on the Users page.
--
-- Before switching the login page over, list the accounts Google will not
-- find. Each row needs its email corrected on the Users page (which keeps the
-- account and everything on it), or confirming:
--
--   select u.email as login_email, p.email as profile_email, p.full_name,
--          u.email_confirmed_at is null as unconfirmed
--     from auth.users u
--     left join public.profiles p on p.id = u.id
--    where u.email !~* '@yourcompany\.com$'
--       or lower(u.email) is distinct from lower(p.email)
--       or u.email_confirmed_at is null;
--
-- Safe to re-run.
-- ============================================================

create table if not exists public.account_invites (
  email      text primary key check (email = lower(email)),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.account_invites enable row level security;
revoke all on public.account_invites from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
  invited  boolean;
  supplied text;
begin
  select count(*) = 0 into is_first from public.profiles;

  delete from public.account_invites
   where email = lower(new.email)
  returning true into invited;

  -- Raising here undoes the auth user as well: the sign-in fails, and the
  -- login page says there is no account for that address.
  if not is_first and invited is not true then
    raise exception 'No account for %. An admin adds people on the Users page.', new.email;
  end if;

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
