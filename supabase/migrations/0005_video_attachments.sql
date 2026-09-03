-- ============================================================
-- 0005 — video attachments
--
-- A screen recording says in ten seconds what a paragraph does not, so the
-- attachments bucket now takes video as well as images and PDFs.
--
-- A bucket has ONE size limit, so it is raised to the largest thing allowed
-- through it (30MB, for video). The per-type rule — 10MB for an image or PDF,
-- 30MB only for video — lives in `src/components/IssueForm.jsx`; this is the
-- outer bound the storage API itself enforces.
--
-- Safe to re-run.
-- ============================================================

update storage.buckets
   set file_size_limit = 31457280,          -- 30MB
       allowed_mime_types = array[
         'image/png','image/jpeg','image/gif','image/webp',
         'application/pdf',
         'video/mp4','video/webm','video/quicktime'
       ]
 where id = 'attachments';
