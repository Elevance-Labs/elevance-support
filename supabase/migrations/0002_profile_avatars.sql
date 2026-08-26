-- ============================================================
-- 0002 — profile photos
--
-- A person may upload a photo of themselves; name, email and role stay where
-- they were (an admin owns those, via the admin-users function). So this adds
-- one column the owner may write, and one bucket they may write into.
--
-- The bucket is PUBLIC, unlike `attachments`. An avatar is decoration shown in
-- every header, comment and timeline row: handing out a signed URL per render
-- would be a lot of round trips for a photo the person chose to show their
-- colleagues. Nothing private is stored here — the path is the owner's user id,
-- which is already visible to any signed-in user via `profiles`.
--
-- Writes are still owner-only: the first folder of the object name must be the
-- caller's uid, so nobody can overwrite somebody else's face.
--
-- Safe to re-run.
-- ============================================================

alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
  'Public URL of the profile photo in the `avatars` bucket, or null. Carries a
   ?v= cache-buster because the object path is fixed per user.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152,
        array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Readable by anyone (the bucket is public); writable only inside your own folder.
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

-- ------------------------------------------------------------
-- Keep the self-update policy to what it was meant for
--
-- `profiles_self_update` lets you write your own row — until now nothing in the
-- UI used it, but the Profile page does (it saves `avatar_url`). As written the
-- policy also let you write your own `role`, which is a self-promotion to admin
-- from the browser with the public anon key. The comment on the policy always
-- said the admin-users function is the only writer of `role`; this makes that
-- true.
--
-- Privileged columns are silently pinned back to their old values rather than
-- raising, so a legitimate write of a normal column still succeeds. The
-- admin-users function runs as `service_role` (auth.uid() is null), so it is
-- untouched, and an admin editing their own row is allowed through.
-- ------------------------------------------------------------
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
    new.email     := old.email;   -- identity; mirrors auth.users
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_freeze_privileged on public.profiles;
create trigger profiles_freeze_privileged
  before update on public.profiles
  for each row execute function public.profiles_freeze_privileged_fields();
