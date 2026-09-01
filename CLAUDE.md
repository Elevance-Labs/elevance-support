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
  (except `supabase.js`/`publicLink.js`, which exist to talk to it) — that is
  what makes it testable.
- **Project keys and ticket numbers are public identifiers.** Once issued they
  are never changed; they live in customers' embed snippets and sent links.
  A share link is the ticket reference (`/i/ACME/42`) and carries no secret, so
  the public view of any ticket is guessable — the `public-issue` allow-list is
  the only thing limiting what that exposes.

## 3. Layout

| Path | Role |
|---|---|
| `src/pages/` | One file per route. Fetches data, owns page state. |
| `src/components/` | Shared UI: ticket dialog, form, comments, timeline, chips, avatars. |
| `src/components/charts/` | Hand-drawn SVG charts. No charting dependency. |
| `src/context/` | App-wide state providers (auth, config, project, refresh). |
| `src/lib/` | Pure domain logic + the Supabase client. Where rules live. |
| `supabase/schema.sql` | Full initial schema, RLS and storage setup. |
| `supabase/migrations/` | Ordered, idempotent changes on top of the schema. |
| `supabase/functions/` | Deno Edge Functions needing `service_role`. |
| `test/` | Behaviour tests run by `vite-node` against a mocked Supabase. |

## 4. Routes and pages

- `/login` — email/password sign-in.
- `/issues` — filterable DataGrid of tickets; admins/managers save **views**.
- `/board` — kanban by status; drag between lanes to change status.
- `/report` — manager/admin analytics over the selected range.
- `/projects` — admin-only CRUD over projects and their members.
- `/users` — admin/manager CRUD over accounts.
- `/config` — admin-only CRUD over the dropdown lists.
- `/profile` — your own account: shows name/email/role, changes photo and
  password. Reached from the header avatar menu. No role guard — everyone has one.
- `/embed/:key/form` — public, no auth, no chrome; one form per project.
- `/i/:key/:number` — share link, addressed by ticket reference: staff get
  redirected to the editable view, everyone else gets a read-only page.
- Guarding happens in `src/App.jsx` via `<Protected require={can.x}>`.

## 5. Contexts — the app's shared state

| Provider | Supplies | Scope |
|---|---|---|
| `AuthContext` | `session`, `profile`, `loading`, sign in/out, `refreshProfile` | Whole app |
| `ConfigContext` | Dropdown lists grouped by type, company list, user roster, active statuses | Authed pages + embed form |
| `ProjectContext` | Project list, the one selected project, persistence | Authed pages only |
| `RefreshContext` | Bump counter so the header can tell a page to reload | Inside `AppLayout` |

- Exactly **one project is always selected** — there is no "all projects" view.
  Selection persists in `localStorage` and falls back to the first visible one.

## 6. Domain modules (`src/lib/`)

- `permissions.js` — **the** role matrix (`admin` / `manager` / `member`) as the
  `can.*` predicate object. Roles are global; project membership decides *which*
  tickets you see. Also owns the 5-minute comment edit window.
- `sla.js` — status types (`new` → `in_progress` → `closed`, with `paused`
  outside the ladder), legal transitions, SLA bands and colours.
- `reports.js` — every aggregation the Report page draws. Pure functions.
- `projects.js` — key format/normalisation, ticket refs, embed and share URLs.
- `format.js` — timestamp parsing (all `timestamptz`, shown local), durations,
  initials, hashed colours.
- `companies.js` — resolving a company from a code or a name, and what the
  pickers and filters may offer.
- `users.js` — how a person is displayed; derives a name from an email when a
  profile has none.
- `publicLink.js` — calls the `public-issue` function; clipboard helper.
- `jira.js`, `supabase.js` — Jira link building; the shared client.

## 7. Data model (conceptual)

- `projects` — name, immutable `key`, status, own ticket counter.
- `companies` — who a ticket is for: display `name` plus a short, stable lower-case
  `code` that embed links carry (`?company=wupi`). Read-only from the browser and
  deliberately **not** in Configuration — maintained with `service_role`. A trigger
  resolves whichever identifier a client sends and stores both on the issue.
- `project_members` — who may see a project's tickets.
- `issues` — the ticket. Request fields, submission details, workflow fields,
  `project_id` + per-project `number` (which also addresses the share link),
  SLA bookkeeping, the company (`company` name + `company_code`), and the
  `source` channel it arrived through. `Form` means the
  public embed form: a trigger stamps it on anonymous inserts (pinning their
  `submitted_date` to now) and refuses it from a signed-in one, so staff pick
  from the other channels and may back-date what they log.
- `comments` — thread on a ticket; author-editable for 5 minutes (RLS-enforced).
- `status_events` — every status change, written by trigger; feeds the timeline.
- `attachments` + a **private** storage bucket; access via short-lived signed URLs.
- A **public** `avatars` bucket, one object per user at `<uid>/avatar`; writes are
  owner-only. Public because avatars render everywhere — nothing private lives there.
  Everything that draws a person goes through `components/UserAvatar.jsx`; only
  `/profile` writes one.
- `list_items` — one table backing every dropdown (`type`, `product`, `area`,
  `priority`, `status`, `labels`, `source`), plus per-status type and per-type
  SLA target.
- `profiles` — mirrors auth users; carries the role and `avatar_url`. First
  account becomes admin. Self-writes are allowed, but a trigger freezes `role`,
  `is_active` and `email` for non-admins — only `admin-users` writes a role.
- `views` — saved Issues filter sets.

## 8. Edge Functions

- `admin-users` — create/delete accounts, change roles, reset passwords, ban and
  unban. Needed because `service_role` must never reach a browser.
- `public-issue` — resolves `(project key, ticket number)` to a **field allow-list** for
  the sign-in-free page. Returns attachments as signed URLs.
- `notify-issue` — posts a Google Chat card for each new ticket. Called by an
  `issues` insert trigger via `pg_net`, not by the browser; authenticated by a
  shared secret, so it deploys with `--no-verify-jwt`. Webhook URL and secret
  live in function env + Vault, never in the repo.
- All three are Deno, and deploy with `supabase functions deploy <name>`; the two
  browser-facing ones handle CORS preflight. None can import from `src/` — small,
  deliberate duplication (e.g. display names, the share-link path) is expected
  there.

## 9. How things connect

- A request arrives via the **embed form** (or the staff **Create Issue**
  dialog) → both render the same `IssueForm` — which in `staff` mode also asks
  for source, labels, submission date and a mandatory attachment of the
  customer's original request → row inserted into `issues` →
  triggers assign the project number, the default status and the first
  status event, then fire the Google Chat notification (queued via `pg_net`, so
  it can never fail the insert).
- Staff work it on **Issues** or **Board** → both open the same `IssueDetail`
  dialog → which composes `CommentsThread` and `StatusTimeline`.
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
  `VITE_JIRA_BASE_URL`. See `.env.example`.
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
