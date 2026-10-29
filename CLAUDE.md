# CLAUDE.md — Project Map for AI Agents

Orientation for an agent planning work in this repo. **Read this first; read code
second.** It is deliberately high-level: modules, roles, boundaries and rules —
never line-level detail. Anything granular belongs in the code or `README.md`
(the human-facing product doc, which stays the source of truth for behaviour).

---

## 1. What this is

- In-house **support intake and tracking** app.
- A public, embeddable request form feeds a staff dashboard.
- Multi-**project**: every ticket belongs to exactly one project; the project
  decides who can see it and how the ticket is numbered (`ACME-42`).
- Stack: **React 19 + Vite + MUI** on the front, **Supabase** (Postgres + RLS,
  Auth, Storage, Edge Functions) behind it. No backend of our own.
- Deployed as a static SPA (Vercel / Netlify rewrites to `index.html`).

## 2. Ground rules an agent must not break

- **Security is enforced in the database, not the UI.** Every permission rule in
  `src/lib/permissions.js` is mirrored by RLS policies or an Edge Function. A UI
  change that grants access is not a feature until the SQL agrees.
- **The anon key is public.** Nothing that must stay private may be readable via
  a table policy. Privileged reads/writes go through an Edge Function using
  `service_role`.
- **Business rules live in triggers too** (status transitions, closed-at,
  numbering, frozen keys). Client-side validation is a convenience, never the
  only guard.
- **Pure logic stays pure.** `src/lib/*` must not import React or Supabase
  (except `supabase.js`/`publicLink.js`/`storage.js`, which exist to talk to
  it) — that is what makes it testable.
- **Project keys and ticket numbers are public identifiers.** Once issued they
  are never changed; they live in customers' embed snippets and sent links.
  A share link is the ticket reference (`/i/ACME/42`) and carries no secret, so
  the public view of any ticket is guessable — the `public-issue` allow-list is
  the only thing limiting what that exposes. A company page (`?company=wupi`) is
  the same bargain, guarded by the `public-company` allow-list.

## 3. Layout

| Path | Role |
|---|---|
| `src/pages/` | One file per route. Fetches data, owns page state. |
| `src/components/` | Shared UI: ticket dialog, form, comments, email conversation, rich text editor, timeline, chips, avatars. |
| `src/components/charts/` | Hand-drawn SVG charts. No charting dependency. |
| `src/context/` | App-wide state providers (auth, config, project, refresh). |
| `src/lib/` | Pure domain logic + the Supabase client. Where rules live. |
| `supabase/schema.sql` | Full initial schema, RLS and storage setup. |
| `supabase/migrations/` | Ordered, idempotent changes on top of the schema. |
| `supabase/functions/` | Deno Edge Functions needing `service_role`. |
| `test/` | Behaviour tests run by `vite-node` against a mocked Supabase. |

## 4. Routes and pages

- `/login` — email/password sign-in.
- `/dashboard` — the selected project's open work: your queue, what is close to
  breaching, and status/assignee/severity breakdowns. No role guard.
- `/issues` — filterable DataGrid of tickets; admins/managers save **views**.
- `/board` — kanban by status; drag between lanes to change status.
- `/report` — manager/admin analytics over the selected range.
- `/schedule` — the selected project's **support rota**; manager/admin. Exists
  because Projects is admin-only and running the rota is not the same power as
  renaming or deleting a project. Same `ScheduleManager` as the Projects dialog.
- `/projects` — admin-only CRUD over projects, their members and their
  **support schedule** (a dialog wrapping the same `ScheduleManager`).
- `/users` — admin/manager CRUD over accounts.
- `/config` — CRUD over the dropdown lists and the comment templates. Admins get
  every tab; managers only Labels and Templates (`can.manageList` /
  `can.manageTemplates`).
- `/profile` — your own account: shows name/email/role, changes photo and
  password, and — with the email grant — your email signature. Reached from the header avatar menu. No role guard — everyone has one.
- `/embed/:key/form` — public, no auth, no chrome; one form per project.
- `/i/:key/:number` — share link, addressed by ticket reference: staff get
  redirected to the editable view, everyone else gets a read-only page.
- `/tickets?company=<code>` — public, read-only list of one company's tickets
  across all projects, groupable by status, product or area (`&group=`). With
  `&email=` it splits into My tickets / All tickets. Staff see the same page;
  no redirect.
- Guarding happens in `src/App.jsx` via `<Protected require={can.x}>`.

## 5. Contexts — the app's shared state

| Provider | Supplies | Scope |
|---|---|---|
| `AuthContext` | `session`, `profile`, `loading`, sign in/out, `refreshProfile` | Whole app |
| `ConfigContext` | Dropdown lists grouped by type, company list, user roster, comment templates, active statuses | Authed pages + embed form (no roster or templates there) |
| `ProjectContext` | Project list, the one selected project, persistence | Authed pages only |
| `RefreshContext` | Bump counter so the header can tell a page to reload | Inside `AppLayout` |

- Exactly **one project is always selected** — there is no "all projects" view.
  Selection persists in `localStorage` and falls back to the first visible one.
- The picker lives in the **header** (`AppLayout`), shown only on the routes
  marked `scoped` in its nav list. Pages read the selection; none draws its own.

## 6. Domain modules (`src/lib/`)

- `permissions.js` — **the** role matrix (`admin` / `manager` / `member`) as the
  `can.*` predicate object. Roles are global; project membership decides *which*
  tickets you see. Also owns the 5-minute comment edit window, and `setSeverity`
  / `refile` — internal vs. the public form, not a role distinction — and
  `emailCustomer`, a per-person grant (`profiles.can_email`) rather than a role,
  which only an admin hands out (`grantEmail`). Configuration is split by list:
  admins every one, managers `labels` and the comment templates.
- `sla.js` — status types (`new` → `in_progress` → `closed`, with `paused`
  outside the ladder), legal transitions — forward only, except that an **admin**
  may reopen a closed ticket into an `in_progress` status (`can.reopen`, mirrored
  by the rules trigger) — SLA bands and colours. Also the two
  gates on leaving `new`: the severity gate (no ticket enters `in_progress` or
  `paused` untriaged) and the assignee gate (nothing leaves `new` at all with
  nobody on it — `closed` included, which is where the two differ). The SLA
  target comes from the ticket's **severity**, not its type; the clock still runs
  from submission, so an untriaged ticket counts against no target. A ticket in a
  `new` status is offered no `new` status to move to (a UI nudge, not a DB rule).
- `reports.js` — every aggregation the Report page draws. Pure functions.
- `dashboard.js` — the Dashboard's aggregations, all over **open tickets only**:
  one person's queue, the SLA watch-list and its threshold, and breakdowns with
  shares. Builds on `reports.js`'s `decorate`. A breakdown field may yield an
  **array** — a ticket on two people counts for both, so that one breakdown's
  shares can add past 100%.
- `assignees.js` — who is on a ticket: the cap of two, normalising a picker's
  selection, comparing sets, and the **one-per-department** rule (`sharedDepartment`,
  `canJoin`). Order matters — the first name is who it is mainly on.
- `schedules.js` — the support rota: day keys (plain `YYYY-MM-DD` strings, never
  parsed into instants), which schedule covers a date, overlap detection, and
  past/current/upcoming.
- `projects.js` — key format/normalisation, ticket refs, embed and share URLs.
- `format.js` — timestamp parsing (all `timestamptz`, shown local), durations,
  initials, hashed colours.
- `companies.js` — resolving a company from a code or a name, and what the
  pickers and filters may offer. Also the company page's URL and its grouping.
- `users.js` — how a person is displayed; derives a name from an email when a
  profile has none. Also `DEPARTMENTS` — a **hardcoded** five (Product, Design,
  Support, Engineering, Quality), mirrored by a check constraint and by
  `admin-users`; a sixth is a migration, not a Configuration row.
- `attachments.js` — what kind an attachment is (image / video / pdf) and its
  size label, plus **what may be attached** (types, per-type size, file count) —
  one gate for the request form and the comment composer, both through the
  `useAttachmentDraft` hook. Feeds `AttachmentGallery` + `AttachmentViewer`, the
  one thumbnail grid and lightbox used by the form, the ticket dialog, the
  comment thread and the share page.
- `storage.js` — uploading to and signing from the private `attachments` bucket.
- `email.js` — the Conversation tab's rules: the subject (always
  `[REF] title`, mirrored in `email-send`), thread order, delivery labels, Cc
  parsing, the signature an email goes out with. Sending and receiving are Edge
  Functions, never the browser.
- `contacts.js` — picking from a project's remembered email addresses: what a
  box suggests (case-insensitive, newest first) and how a pick completes the
  Cc line. Read through the `useProjectContacts` hook; staff only.
- `richText.js` — the rich text **document** (paragraphs and lists of marked
  runs) that the email box, signatures, comments and comment templates are read
  into. HTML never leaves the browser and is never rendered from data:
  `email-send` re-checks the document and builds the email's HTML from it; the
  UI draws it with React. Also how a comment or template is stored — the
  document plus its plain text — and read back, plain-text rows included.
  Mirrored in `email-send`.
- `publicLink.js` — calls the `public-issue` and `public-company` functions;
  clipboard helper.
- `chat.js` — the Google Chat thread link built from a ticket's recorded thread
  name; the web address is Google's, so it is built in this one place.
- `jira.js`, `supabase.js` — Jira link building; the shared client.

## 7. Data model (conceptual)

- `projects` — name, immutable `key`, status, own ticket counter.
- `companies` — who a ticket is for: display `name` plus a short, stable lower-case
  `code` that embed links carry (`?company=wupi`). Read-only from the browser and
  deliberately **not** in Configuration — maintained with `service_role`. A trigger
  resolves whichever identifier a client sends and stores both on the issue.
- `project_members` — who may see a project's tickets.
- `project_schedules` — the support rota: a project, an inclusive `starts_on` /
  `ends_on` date range and the one or two `assignee_ids` on support for it.
  Ranges may not overlap within a project — an exclusion constraint, so "who is
  on for this day" always has exactly one answer — and a pair on one must span
  two departments, same rule as a ticket. Read by project members. **Admins**
  create, update and delete any; **managers** create any and update/delete only
  current and upcoming ones (`can.changeSchedule`), in projects they belong to.
  "Past" is judged on the UTC day. RLS refuses by matching no rows, so the UI
  withholds the controls and reports a write that came back empty. A ticket's `submitted_date` (taken in **UTC**) is what
  the insert trigger looks up, so a back-dated ticket lands on whoever was on
  then, not on today's pair.
- `issues` — the ticket. Request fields, submission details, workflow fields,
  `project_id` + per-project `number` (which also addresses the share link),
  SLA bookkeeping, the company (`company` name + `company_code`), the
  `source` channel it arrived through, `severity`, `assignee_ids`, and
  `chat_thread` — the Google Chat thread it was announced in, written only by
  `notify-issue` (a trigger drops or refuses it from anyone else).
  `submitted_type` / `submitted_product` / `submitted_area` /
  `submitted_priority` are the classification the request **arrived** with,
  stamped at insert and frozen by trigger — the basis for reporting how often a
  ticket is filed as one thing and worked as another. Null on rows predating
  them: unknown, not unchanged. `type` and `priority` are frozen too, so only
  `product` and `area` move, and any signed-in user may move them at any point
  (the old admin/manager + New-only lock is gone).
  `severity` is internal: an anonymous insert never carries one (the trigger
  drops it), only a signed-in user may change it, and a trigger refuses any move
  into an `in_progress` or `paused` status while it is empty. It is deliberately
  absent from the `public-issue` and `public-company` allow-lists.
  `assignee_ids` is a `uuid[]` of at most two, replacing the old single
  `assignee_id`. An array carries no foreign key, so a trigger prunes deleted
  accounts out of it. A trigger fills an empty set from the project's schedule
  at insert; after that anyone signed in may pick up a ticket nobody holds, but
  **only an admin or manager may change a set that already names somebody**. A
  second trigger refuses any move out of a `new` status while it is empty —
  `closed` included, unlike the severity gate. A third refuses a pair from one
  **department**: two assignees must come from two different ones, checked only
  when the set is actually written, so a pair predating a department change is
  grandfathered until someone next touches it. `Form` means the
  public embed form: a trigger stamps it on anonymous inserts (pinning their
  `submitted_date` to now) and refuses it from a signed-in one, so staff pick
  from the other channels and may back-date what they log. A `service_role`
  insert (`email-webhook`) names its own channel, may not claim `Form`, and is
  pinned to now without a severity.
- `comments` — thread on a ticket; author-editable for 5 minutes (RLS-enforced).
  Rich text: `body_doc` is the document, `body` its plain text (what the public
  page falls back to). Rows predating rich text have `body` only, and are drawn
  and edited as plain text. `notify_thread` (off by default) asks for the
  comment to be posted into the ticket's Chat thread; only the insert reads it.
- `email_messages` — the email thread with the requester, in and out, with
  delivery status, and — outbound — the rich text document it went as, body
  and signature. Browser read-only (same sight as the ticket); only
  `email-send` and `email-webhook` write it. A reply finds its ticket by the
  ticket's random `email_token` in the Reply-To address — never by the public
  ticket reference — or by its threading headers; anything else is a new ticket.
- `project_contacts` — the email addresses a project has met, stored lower-case,
  one row per address: ticket requesters (on insert) and the Cc of outbound
  emails (once sent — the `email_messages` row is the proof). Names come from
  the requester name; an inbound email's display name only fills an empty one,
  and never adds an address. Written only by triggers, read only by project
  members, never anon. Suggested — once something is typed — in the email Cc
  and the staff form's requester email.
- `comment_templates` — canned comment text (title + rich text, stored like a
  comment: `body_doc` + `body`, plain-only on old rows) managed under
  Configuration; picking one under the comment or email box only writes into
  the box. Its own table, not a `list_items` type, because `list_items` is
  anon-readable: signed-in read only, admin or manager write.
- `status_events` — every status change, written by trigger; feeds the timeline.
- `attachments` + a **private** storage bucket; access via short-lived signed URLs.
  A row with a `comment_id` belongs to that comment, not the request; only the
  comment's author may add or remove one, inside the same 5-minute window (RLS).
  A row with an `email_message_id` belongs to that email: written only by the
  email functions, never removable, and never on a public page.
- A **public** `avatars` bucket, one object per user at `<uid>/avatar`; writes are
  owner-only. Public because avatars render everywhere — nothing private lives there.
  Everything that draws a person goes through `components/UserAvatar.jsx`; only
  `/profile` writes one.
- `list_items` — one table backing every dropdown (`type`, `product`, `area`,
  `priority`, `severity`, `status`, `labels`, `source`); admins write any row,
  managers only `labels` rows (RLS pins the type both ways). Plus per-status type and,
  on severity rows only (a check constraint), `sla_hours` + `behavior` — the
  target and the sentence a severity commits the team to, which the pickers show
  beside the name. Status rows only may carry a `description` — customer-facing,
  shown on the company page (anon-readable, so written for the public).
- `profiles` — mirrors auth users; carries the role, `avatar_url` and
  `department` (`not null`, default `Support`, one of the five in `users.js`).
  First account becomes admin. Self-writes are allowed, but a trigger freezes
  `role`, `is_active`, `email` and `department` for non-admins — only
  `admin-users` writes a role, and it writes departments too. `can_email` (may
  write to customers) is frozen for every non-admin writer, managers included.
  `email_signature` (optional, rich text document) is the person's own, written
  from `/profile`; `email-send` appends it from the row, never from the browser.
- `views` — saved Issues filter sets.

## 8. Edge Functions

- `admin-users` — create/delete accounts, change roles and departments, reset
  passwords, ban and unban. Needed because `service_role` must never reach a browser.
- `public-issue` — resolves `(project key, ticket number)` to a **field allow-list** for
  the sign-in-free page. Returns attachments as signed URLs — the request's, and
  each comment's with its comment. A comment carries its rich text document
  beside its text.
- `public-company` — resolves a company code (or name) to its tickets, each cut
  to its own **field allow-list**: the request, its attachments (signed URLs),
  submission details including the **requester email** (deliberately — unlike
  `public-issue`), product, area and current status, plus each status's
  description. Drops tickets closed more than 14 days ago, server-side. An
  optional requester email is matched there into a per-ticket `mine` flag. No
  comments, assignees, severity, timeline or SLA — a different list from
  `public-issue`, so widen each on its own merits.
- `notify-issue` — posts a Google Chat card for each new ticket into a thread
  keyed by the ticket reference, and records that thread on the ticket (the
  dialog's "View thread"). Status changes and emails sent/received then reply
  into that thread as one line each — who and what, never an email's
  content — via insert triggers on `status_events` and `email_messages`. A
  comment posted with "Notify in thread" ticked replies with its text (a
  `comments` insert trigger); a ticket with no recorded thread gets none. Called by an
  `issues` insert trigger via `pg_net`, not by the browser; authenticated by a
  shared secret, so it deploys with `--no-verify-jwt`. Webhook URL and secret
  live in function env + Vault, never in the repo.
- `email-send` — sends a staff member's draft to the requester through Mailgun:
  checks the `can_email` grant and project membership by hand (service_role
  skips RLS), decides from/subject/Reply-To/threading headers/layout itself, and
  records the message.
- `email-webhook` — Mailgun's caller: inbound mail (filed on its ticket, or a
  new `Email` ticket in `EMAIL_INTAKE_PROJECT_KEY` — only when the helpdesk is
  in its To, never from a Cc or Bcc; machine mail never makes one) and delivery
  events. Deploys with `--no-verify-jwt`; Mailgun's HMAC
  signature authenticates it. Mailgun keys live in function env only.
- All six are Deno, and deploy with `supabase functions deploy <name>`; the four
  browser-facing ones handle CORS preflight. None can import from `src/` — small,
  deliberate duplication (e.g. display names, the share-link path) is expected
  there.

## 9. How things connect

- A request arrives via the **embed form** (or the staff **Create Issue**
  dialog) → both render the same `IssueForm` — which in `staff` mode also asks
  for source, labels, submission date and a mandatory attachment of the
  customer's original request → row inserted into `issues` →
  triggers assign the project number, the default status, the assignees from
  the project's schedule covering the submitted date, and the first status event, then fire the Google Chat notification (queued via `pg_net`, so
  it can never fail the insert).
- **Dashboard** opens on the same rows, decorated the same way, and counts only
  the ones that aren't closed — so a tile and a breakdown on it always add up.
- Staff work it on **Issues** or **Board** → both open the same `IssueDetail`
  dialog → which composes `CommentsThread` and `ConversationThread` (two tabs,
  both mounted) and `StatusTimeline`.
- Customer email: Conversation tab → `email-send` → Mailgun → customer; their
  reply → the ticket's `t-<token>@` address (or the support inbox, forwarded) →
  Mailgun route → `email-webhook` → `email_messages`.
- **Report** re-reads the same rows and derives everything through
  `reports.js`, so a tile, chart and table can never disagree.
- Anything the header does (creating an issue) reaches the mounted page through
  `RefreshContext`, so neither knows about the other.

## 10. Working in the repo

- `npm run dev` (5173) · `npm run build` · `npm run lint` (oxlint) · `npm test`.
- Tests run under `vite-node` with `test/vite.config.js` aliasing the Supabase
  client to `test/mockSupabase.js`; `TZ` is pinned so date behaviour is stable.
- Tests are **behavioural**: permissions, SLA maths, report aggregation,
  project scoping, form rendering. Add to them when changing a rule.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, optional
  `VITE_JIRA_BASE_URL`. See `.env.example`. Build-time `VITE_BASE` sets the URL
  prefix when the app is not served from the root (GitHub Pages project site);
  it feeds Vite's `base`, the router `basename` and `appOrigin()`.
- Deploys: Vercel/Netlify from `dist/` (rewrites in `vercel.json` /
  `public/_redirects`), or GitHub Pages via `.github/workflows/pages.yml`
  (no rewrites there — `404.html` is the SPA fallback).
- Schema changes go in a **new numbered, idempotent migration** — never by
  editing `schema.sql` alone.

---

## 11. Maintaining this file

**Update `CLAUDE.md` as part of any change that alters the map above.** Treat it
as code: it ships in the same commit as the change it describes.

Update it when a change:

- adds, removes or renames a **route, page, context, lib module or Edge Function**;
- changes the **role matrix**, a permission boundary, or where a rule is enforced;
- adds or reshapes a **table**, or changes what a public identifier means;
- changes the **build, test or deploy** commands or required env vars;
- changes **how modules connect** (a new shared provider, a new data flow).

Do **not** update it for: bug fixes, styling, copy changes, refactors inside a
module, new tests, or anything a reader would call an implementation detail.

Rules for edits:

- Keep it **pointers, not prose**. Bullets and tables only.
- Keep it **short** — if a section needs paragraphs, it belongs in `README.md`.
- Never paste code, signatures, column lists or line numbers into this file.
- Prefer editing an existing bullet over adding a new section.
