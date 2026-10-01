-- ============================================================
-- 0010 — attachments on comments
--
-- A reply often needs a picture: "here is the fix on staging", "is this the
-- screen you meant?". Comments now take the same files a request does —
-- images, PDFs and video, under the same limits (the bucket is unchanged).
--
-- They live in the same `attachments` table, with a `comment_id` saying which
-- comment they belong to; a null `comment_id` is a file on the request itself,
-- which is every row that predates this. `issue_id` is still set on a
-- comment's files, so reading them rides on the existing `att_staff_read`
-- policy — whoever can see the ticket can see its comments' files.
--
-- A comment's files follow the comment's own rules, not the ticket's:
--   * only its author may add one, and only inside the 5-minute window in
--     which they could still edit it — after that a comment is settled, and a
--     late file would change it as surely as a late edit;
--   * the file must be on the same ticket as its comment;
--   * the public form (anon) cannot add one at all — anon reads no comments,
--     so the check below can never pass for it;
--   * removing one is the author's, inside the same window. Deleting the
--     comment takes its rows with it (on delete cascade), which bypasses RLS.
--
-- The share page shows comments, and so it shows their files too — see the
-- `public-issue` function.
--
-- Safe to re-run.
-- ============================================================

alter table public.attachments
  add column if not exists comment_id uuid references public.comments(id) on delete cascade;

create index if not exists attachments_comment_idx on public.attachments(comment_id)
  where comment_id is not null;

-- True when the signed-in user wrote `p_comment`, on `p_issue`, within the
-- last five minutes: the edit window `comments_update_own` enforces.
create or replace function public.can_modify_comment(p_comment uuid, p_issue uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.comments c
     where c.id = p_comment
       and c.issue_id = p_issue
       and c.author_id = auth.uid()
       and c.created_at > now() - interval '5 minutes'
  );
$$;

drop policy if exists att_public_insert on public.attachments;
create policy att_public_insert on public.attachments for insert to anon, authenticated
  with check (comment_id is null or public.can_modify_comment(comment_id, issue_id));

drop policy if exists att_staff_delete on public.attachments;
create policy att_staff_delete on public.attachments for delete to authenticated
  using (
    public.can_see_issue(issue_id)
    and (comment_id is null or public.can_modify_comment(comment_id, issue_id))
  );
