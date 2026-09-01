# Support Tool

An in-house support intake and tracking app: a public, embeddable request form
feeding a dashboard your team works out of.

React + Vite + Material UI on the front, Supabase (Postgres, Auth, Storage) behind it.

## Pages

| Page | What it does |
|---|---|
| **Issues** | Every request in a filterable table. Admins save filter sets as **views** everyone can load. |
| **Board** | Jira-style kanban by status. Drag a card between lanes to change its status. Each card leads with its ticket reference and type. |
| **Report** | Volume, breakdowns and SLA performance for the selected range. |
| **Projects** | Admin-only CRUD over projects, their keys and their members. |
| **Users** | Admin-only CRUD over who can sign in and be assigned work. |
| **Configuration** | Admin-only CRUD over the lists that drive every dropdown — types, products, areas, priorities, statuses, labels and sources. |
| **Profile** | Your own account — reached from the avatar in the header. Shows your name, email and role; lets you change your photo and your password. |

## Roles

| | Member | Manager | Admin |
|---|:--:|:--:|:--:|
| Work tickets on Issues and Board | ✅ | ✅ | ✅ |
| Comment (edit/delete own for 5 min) | ✅ | ✅ | ✅ |
| Load saved views | ✅ | ✅ | ✅ |
| Create / rename / delete views | — | ✅ | ✅ |
| See Reports | — | ✅ | ✅ |
| Reset passwords (managers & members) | — | ✅ | ✅ |
| Disable accounts (managers & members) | — | ✅ | ✅ |
| Reset password / disable an **admin** | — | — | ✅ |
| Create or delete accounts, change roles | — | — | ✅ |
| Create projects, set members, close them | — | — | ✅ |
| **Delete tickets** | — | — | ✅ |
| Configuration lists | — | — | ✅ |

Disabling an account bans it at the auth layer, so a disabled user genuinely
cannot sign in — and is signed out automatically if they were already active.
Nobody can disable their own account.

The rules live in [`src/lib/permissions.js`](src/lib/permissions.js) and are
mirrored by row-level security and the `admin-users` function, so the UI is a
convenience rather than the only guard.

## Projects

Every ticket belongs to exactly one project, and **nobody ever looks at two at
once**. Issues, Board and Report each carry a single-select project filter at
the top; there is no "all projects" option, because a combined view would be a
view of data the viewer may not be entitled to hold in one place.

The choice is remembered in the browser, so signing back in lands you where you
were working. A remembered project you have since been removed from simply falls
back to the first one you can see — a stale entry can't resurrect access.

A project has four things:

| | |
|---|---|
| **Name** | What people call it. Changeable. |
| **Key** | Three or four letters — `ACME`. Unique, and **permanent**. |
| **Members** | Who can see its tickets. |
| **Status** | Incoming, In Progress or Closed. |

### The key

The key is the project's public face and it appears in three places, which is
why it can never be changed once the project exists:

```
ACME-42                          the ticket identifier
/embed/ACME/form                 the embeddable intake form
/i/ACME/42                       a ticket's share link
```

A customer may have pasted that embed URL into their own page and been sent that
share link by email. Re-keying the project would break both. The Edit dialog
shows the key locked with a padlock, and a database trigger refuses the change
however the update arrives.

**Ticket numbers count within a project**, so each project starts at 1 — `ACME-1`
and `BILL-1` are different tickets. Numbers are handed out by a database
function that takes a row lock on the project, so two requests submitted in the
same instant can't be given the same number. A ticket can't be moved between
projects afterwards: its number, its share link and its embed origin all belong
to where it was filed.

### Members and roles

**Roles are global, not per project.** Adding someone to a project grants access
to it; what they may do once inside is decided by their role, identically in
every project. A manager is a manager everywhere they've been added.

Membership is enforced by row-level security, not just by the filter — the
`issues` policy, and the policies on comments, attachments and the status
timeline, all check membership of the ticket's project. Admins are exempt, since
they create projects and would otherwise be locked out of their own.

## Companies

Every ticket belongs to a **company**, chosen from a list rather than typed. That
is the whole point: one customer typed three ways ("Wilbert's U-Pull-It",
"Wilberts UPullIt", "wupi") is three customers in every report.

A company has two identifiers:

| | What it's for |
|---|---|
| **Name** — `Wilbert's U-Pull-It` | What everyone reads. It is what the ticket stores and what the filters, lists and public page show. |
| **Code** — `wupi` | Short, lower case, stable. It is what an embed link carries (`?company=wupi`) and what the ticket keeps alongside the name, so renaming a company doesn't split its history. |

**There is no Configuration tab for companies** — they are onboarded rarely, so
the list lives in the Supabase dashboard (**Table Editor → companies**) or in
SQL:

```sql
insert into public.companies (name, code) values ('Wilbert''s U-Pull-It', 'wupi');
```

Set `is_active` to false to retire one: it stops being offered on the forms but
stays readable on the tickets that already have it, and stays available in the
Company filter on Issues and Board. Those filters also list any company found on
a ticket but not on the list, so tickets logged before the list existed are never
stranded.

Whichever identifier a form or a link supplies, a database trigger resolves it
against the list and stores both — so a ticket can never carry one company's code
and another's name.

## Ticket detail

The header reads **project name · ticket identifier** — `Acme Support · ACME-42`
— because which queue a ticket belongs to is the context for reading its number.

Opening a ticket gives a three-column view:

- **Left** — the read-only submission details, then the request fields
  (type, product, area), then the remaining controls (priority, labels, Jira).
  The **Jira** field takes a pasted Jira link as happily as a typed key: whatever
  you paste is reduced to the ticket key (`ENG-1234`) when you leave the field
  and again when you save, so the "Open in Jira" link is always well formed.
  Text with no key in it is left exactly as you wrote it.
- **Centre** — **assignee and status side by side** at the top — the assignee
  picker shows each person's photo, and the status picker a coloured dot for the
  status *type*, the same dot the board columns use — then the description,
  then the **comment** thread with the composer beneath the existing comments.
  Anyone signed in can comment; the author can edit or delete their own comment
  for **5 minutes**, after which the buttons disappear on their own. The
  5-minute rule is enforced by row-level security too, so it can't be bypassed
  via the API. **Ctrl+Enter** (or **Cmd+Enter**) posts the comment, and saves an
  edit in progress; plain Enter is still a newline, since the box is multi-line.
  **Escape** cancels an edit.
- **Right** — the **status timeline**: the statuses this ticket has actually been
  through, in order, showing who moved it there, when, and how long it sat in the
  previous status. Statuses it never reached are not drawn. Total elapsed time
  sits at the top.

The **link button** in the header copies a public share link for the ticket —
see [Share links](#share-links) below.

New tickets automatically start at the first status in sort order, and every
status change is recorded by a database trigger — so tickets submitted through
the public form get a timeline too.

## Statuses, status types and SLAs

Every status belongs to one of four **status types**, set per status on the
Configuration page:

```
new  ──▶  in_progress  ──▶  closed
          ▲           ▲
          └─ paused ──┘   (suspends, then returns)
```

| Status type | Colour |
|---|---|
| New | ⬜ grey `#6b7280` |
| In Progress | 🟦 blue `#1976d2` |
| Paused | 🟧 orange `#ef6c00` |
| Closed | 🟩 green `#2e7d32` |

**Statuses are coloured by their type, not individually** — every "in progress"
status looks the same wherever it appears, whatever you call it. There is no
per-status colour to set. The dot is drawn by
[`src/components/StatusDot.jsx`](src/components/StatusDot.jsx) everywhere it
appears — board columns and the ticket's status picker — and carries the type's
name as a tooltip, so the colour is never the only thing saying what it means.

**Paused** stops the SLA clock. A ticket can be paused from anywhere except a
closed status, and the time it spends paused is excluded from its SLA. Pausing
is a suspension rather than a move, so leaving a pause is judged against the
status the ticket was paused *from*: a ticket paused while In Progress can
resume or close, but still cannot go back to New.

You can have as many statuses as you like inside each type. A ticket may move
**within its own type or forward to a later one, never backward** — so New →
In Progress → Closed is fine, but In Progress → New and Closed → anything are
rejected. Paused sits outside that ladder and is always available. The status dropdown only offers legal moves, and the rule is enforced
again by a database trigger so it holds however the update arrives.

**SLA targets are set per request type** (Configuration → Types), in hours. The
clock starts when the ticket is submitted and **stops the moment the ticket
reaches a status of type Closed** — `issues.closed_at` is stamped by a trigger.

| Band | Consumed | Colour |
|---|---|---|
| On track | under 40% | 🔵 blue |
| Watch | 40% – 70% | 🟡 yellow |
| At risk | 70% – 100% | 🟠 orange |
| SLA breached | over 100% | 🔴 red |
| No SLA | — | the ticket's type has no target set |

Boundaries sit at the start of each band: exactly 40% is yellow, exactly 70% is
orange. Only going *past* the target counts as a breach, so a ticket sitting at
exactly 100% is still orange. A closed ticket that never breached is labelled
**Met SLA** and keeps the colour of the band it finished in.

The band colour shows in three places: the total-elapsed box in the ticket
detail (with a progress bar and the percentage consumed), the left edge and age
badge of each board card, and the SLA column on the Issues list.

**Resolved tickets age out of the working views.** The Board only keeps a closed
ticket for **7 days** after it was resolved; each lane says how many it is
hiding. The Issues list has the same limit as a **Resolved** filter, which
defaults to the last 7 days and can be widened to 30 days, 60 days or all time.
Either way only *closed* tickets are affected — open work always shows, and a
closed ticket with no recorded resolution time is never hidden.

**Request fields** (type, product, area) can only be changed by an **admin or
manager**, and only while the ticket is still in a **New** status. After that
they're locked, with a padlock explaining why. Enforced by trigger as well.

## Reports

Managers and admins get a read-only dashboard over **one project's** tickets,
filtered by **range** (7 / 30 / 90 days or all time), and optionally by type and
product.
Everything on the page is derived from the same rows, so a tile, a chart and a
table can never disagree.

- **Tiles** — submitted, still open, closed, median time to close, and the
  percentage that met SLA. The SLA figure is measured **only over tickets whose
  type has a target**; counting untargeted tickets as met would flatter it.
- **Volume over time** — submitted against closed, bucketed by day, week or
  month depending on how long the range is. Quiet buckets are drawn as zero
  rather than skipped.
- **Breakdowns** — open tickets by status (in the configured workflow order),
  and tickets by request type, product and area. Past the top few, the tail is
  grouped as **Other** instead of growing the chart.
- **Age of open tickets** — how long the open queue has been waiting, in bands.
- **Priority mix** and **SLA position of open tickets** — one bar each, split
  into its parts, with the counts spelled out in the legend.
- **SLA performance by request type** — target, volume, breaches, met % and
  median time to close, per type.
- **Closest to breaching** — the open tickets that have used the most of their
  target. Click a row to open the ticket.

Two things are worth knowing when reading it: tickets are counted **by
submission date**, and anything described as open is **as of now** regardless of
the range. Ranges, breakdowns and SLA maths live in
[`src/lib/reports.js`](src/lib/reports.js) as plain functions, covered by
[`test/reports.test.js`](test/reports.test.js).

The charts are hand-drawn SVG in [`src/components/charts/`](src/components/charts/) —
no charting dependency. Their colours come from
[`palette.js`](src/components/charts/palette.js), which keeps three sets apart:
categorical hues for identity (assigned in a fixed, colourblind-checked order,
never cycled), a single-hue ramp for ordered bands, and the reserved SLA band
colours from [`src/lib/sla.js`](src/lib/sla.js) for state.

## Names

People are shown by **full name** everywhere — assignee pickers, board cards,
comments, the status timeline, the header. Email addresses only appear where
they are the point: the Users table and a ticket's submission details.

Accounts created straight from the Supabase dashboard arrive with no name, which
is why emails used to show up instead. Two things prevent that now:

- [`src/lib/users.js`](src/lib/users.js) derives a readable name from the email's
  local part when a profile has none — `jane.doe@acme.com` reads as "Jane Doe".
- The signup trigger in [`supabase/schema.sql`](supabase/schema.sql) does the same
  on the way in, so new accounts are never nameless.

Set a proper name on the Users page whenever the derived one isn't right.

## Your profile

The avatar in the top-right corner opens a menu with **Profile** and **Sign out**.

The Profile page shows your name, email and role, and lets you change the two
things that are actually yours:

- **Your photo.** PNG, JPEG, GIF or WebP up to 2 MB. It replaces your initials
  everywhere you appear: the header, board cards, the Assignee column and both
  assignee pickers (the option list and the selected field), comments, a
  project's member list, the Users table, and — on your comments — the public
  share-link page. Uploads go to the `avatars` storage bucket at `<your user id>/avatar`
  — one object per person, overwritten in place, so changing your photo never
  leaves an orphan behind. **Remove** clears the photo and you fall back to your
  initials.
- **Your password.** You must type your current password first: the app proves it
  before changing anything, so an unattended signed-in browser isn't enough to
  take the account over. Minimum eight characters.

Your **name, email and role are read-only here** — they identify you to everyone
else, and an admin owns them on the Users page.

Everyone else's photo is **view only** wherever it appears — including the Users
table, where an admin edits names, roles and access but never someone's face.
Only the owner can change their own, and that is enforced by the storage policy
rather than by hiding a button.

A person with no photo falls back to their initials on a colour hashed from
their name, so they are still recognisable at a glance and stay the same colour
on every page. One component, [`src/components/UserAvatar.jsx`](src/components/UserAvatar.jsx),
draws all of it.

Unlike `attachments`, the `avatars` bucket is **public**: an avatar is drawn in
every header and comment row, and signing a URL per render would be a lot of
round trips for a photo its owner chose to show colleagues. Writes are still
owner-only — the storage policy requires the first folder of the object path to
be your own user id. Because the path never changes, the saved URL carries a
`?v=` cache-buster.

Saving your own profile row goes through the `profiles_self_update` policy. A
trigger pins `role`, `is_active` and `email` back to their old values on any
self-write by a non-admin, so that policy cannot be used from the browser to
promote yourself — the `admin-users` function stays the only writer of `role`.

## Setup

### 1. Create the Supabase project

Create a project at [supabase.com](https://supabase.com), then open the **SQL Editor**
and run [`supabase/schema.sql`](supabase/schema.sql). That creates every table, the
row-level-security policies, the private `attachments` storage bucket, and a starter
set of configuration lists.

### 2. Point the app at it

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from
**Project Settings → API**. Optionally set `VITE_JIRA_BASE_URL`
(e.g. `https://acme.atlassian.net`) to turn Jira ticket IDs into links.

### 3. Create your first admin

Supabase dashboard → **Authentication → Users → Add user** (tick *Auto Confirm*).

A trigger creates the matching profile automatically, and **the first account to
exist becomes an admin** — so there's nothing to run by hand. From then on you can
add everyone else from the **Users** page.

> **Admin pages missing from the side nav?** Users and Configuration are admin-only.
> If they aren't showing, your account has no `profiles` row or isn't an admin.
> Re-run [`supabase/schema.sql`](supabase/schema.sql) in the SQL editor — it is
> safe to run again — then promote your account with
> `update public.profiles set role = 'admin' where email = 'you@example.com';`
> and sign out and back in.

### 4. Deploy the user-management function

Creating and deleting login accounts needs the `service_role` key, which must never
ship to a browser — so it runs in an Edge Function:

```bash
supabase functions deploy admin-users
```

Until this is deployed the Users page can read the roster but not modify it.

### 4b. Deploy the public ticket view

[Share links](#share-links) are served by a second function, for the same reason:

```bash
supabase functions deploy public-issue
```

Until this is deployed, share links work for signed-in staff but show a dead end
to everyone else.

### 4c. Deploy the new-ticket notification

Whenever a ticket is created — from the embed form or from Create Issue — a card
is posted to a Google Chat space. See
[New-ticket notifications](#new-ticket-notifications) for the setup; the function
itself deploys like the others, but with JWT verification off, because its caller
is the database rather than a signed-in user:

```bash
supabase functions deploy notify-issue --no-verify-jwt
```

Until it is deployed, tickets are created exactly as before and nothing is posted.

### 5. Schema changes from here on

[`supabase/schema.sql`](supabase/schema.sql) is the baseline as of go-live: run it
once on a fresh project and you have everything. Any change after that goes in
`supabase/migrations/` as its own numbered, idempotent file, applied in order —
`schema.sql` is only edited to fold in a migration that has already shipped
everywhere.

## New-ticket notifications

Every new ticket posts a card into a Google Chat space: type and priority, the
title, the company and the requester's name and email, and a button to the
ticket's [share link](#share-links).

It hangs off the **insert**, not off either form. A ticket can be created from
the public embed form or from the staff Create Issue dialog, and both end as one
insert into `issues`, so the trigger `issues_notify_new`
([migration 0001](supabase/migrations/0001_new_issue_notification.sql)) is the
one place that sees all of them. The trigger runs after the number and the
default status are assigned, so the card can already name the ticket `ACME-42`
and link to it.

The HTTP call is made with `pg_net`, which queues the request and returns at
once. That is deliberate: a customer submitting the form must never see it fail
because Chat is unreachable. Every failure path in the trigger returns the row
unchanged, so a broken notification can cost you a message but never a ticket.

### Setting it up

The Chat webhook URL is a bearer secret — anyone holding it can post into your
space — so it never goes in the repo and never reaches a browser. It lives in
the function's environment:

```bash
supabase secrets set \
  GOOGLE_CHAT_WEBHOOK_URL='https://chat.googleapis.com/v1/spaces/…' \
  NOTIFY_SHARED_SECRET='<a long random string>' \
  APP_BASE_URL='https://support.example.com'
```

`APP_BASE_URL` is the origin of the deployed app, and is what makes the button on
the card point somewhere real.

The database needs two matching values of its own, held in Supabase Vault so they
are not written into a migration. Run once per environment, in the SQL editor:

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/notify-issue', 'notify_issue_url');
select vault.create_secret('<the same long random string>', 'notify_issue_secret');
```

`notify_issue_secret` must equal `NOTIFY_SHARED_SECRET`. The function is deployed
with `--no-verify-jwt` because Postgres has no user JWT to send, so that shared
secret is the only thing authenticating the call — treat it like a password, and
make it long and random.

Until both Vault secrets exist the trigger does nothing at all, which is what you
want on a local or preview database: it should not page anybody.

### Getting the webhook URL

In Google Chat, open the space → **Apps & integrations** → **Webhooks** → **Add
webhook**. Incoming webhooks require a Google Workspace account; they are not
available on personal Google accounts. If the URL ever leaks, delete the webhook
in that menu and create a new one — the URL *is* the credential, so rotating it
is the only fix.

## Creating a ticket by hand

Not every request arrives through the form — plenty come by email or phone.
**Create Issue** in the top-right header opens the same form in a dialog, with
nothing hidden. Fill in the customer's own details: the ticket is attributed to
them, not to whoever logged it. The Issues list and Board reload automatically
once it's created.

Because you are logging somebody else's request, the internal form asks for four
things the public form doesn't:

| Field | Why |
|---|---|
| **Source** | Which channel it arrived through — Email, IM, SMS, Call, Internal. Editable under Configuration → Sources. |
| **Labels** | So a ticket can be triaged as it's logged, instead of re-opened to do it. |
| **Submitted** | When the customer actually sent it, not when you got round to logging it. Defaults to now; a future date is refused. |
| **An attachment** | **Required.** Attach the customer's own request — the email itself, or a screenshot of the email, chat or message. Without it the ticket is one person's account of what somebody else said. |

**`Form` is not one of the Source choices**, because it means "arrived through
the public embed form" — something only the database can know. An anonymous
submission is stamped `Form` on insert, and a signed-in one is refused if it
tries to claim it. The same trigger pins a public submission's date to the moment
it arrives: staff may back-date, the public form may not.

## Share links

A ticket's share link is just its reference. **ACME-42** lives at:

```
https://support.yourcompany.com/i/ACME/42
```

So the link is constructible by hand — you can type one into Slack from the
ticket number alone, without opening the ticket to copy it. The link button in
the ticket header copies it for you.

Numbers restart at 1 in every project, so the key is what makes the pair unique:
`ACME-42` and `BILL-42` are different tickets, and a number under the wrong key
resolves to nothing.

Who opens it decides what happens:

- **Signed in** — straight to the issues list with the ticket open in the usual
  editable dialog. There is one place where work happens, and this isn't a second
  one.
- **Not signed in** — a read-only page showing only the title, description,
  attachments, company, Jira ticket and comments. Status, priority, assignee, the
  requester's email, the timeline and SLA are all withheld: this is a page a
  customer may end up looking at.

Staff opening a link are handed to `/issues` with the ticket's **project** in
tow, so the list they land on is filtered to it rather than to whatever they had
selected last.

### These links are guessable, on purpose

Ticket numbers are sequential, so anyone can walk `/i/ACME/1`, `/i/ACME/2`, … and
read the public view of every ticket in the project. There is no secret in the
URL, and nothing else stands in the way — that is the cost of links you can write
down, and it was chosen knowingly.

What that means in practice: **treat the six fields on the public page as world-
readable for any project whose key is known.** Titles, descriptions, company
names and comment threads are all in that set. If a project handles anything that
can't be, it shouldn't be shared this way.

Two things limit the damage, and both are worth keeping:

- The page is served by the `public-issue` Edge Function, which reads with the
  `service_role` key and returns **only** title, description, attachments,
  company, Jira ticket and comments. Status, priority, assignee, requester email,
  internal notes, the timeline and SLA never leave the database. That allow-list
  is now the only thing protecting them, so treat any addition to it as a
  decision to publish that field.
- Nothing was opened up in row-level security. The anon key is public, so a policy
  wide enough to serve this page would expose every column of every ticket
  instead of six fields.

Attachments come back as one-hour signed URLs; the bucket itself stays private,
so an attachment URL can't be guessed even though the ticket URL can.

Comment authors appear by **name and photo** on the public page — a support
reply reads better from a person than from a grey circle. The photo is on the
allow-list deliberately: the `avatars` bucket is public already, so the file was
always reachable, but this page is what ties a face to a name for anyone holding
a share link. That is the same exposure the name itself carries. If a
customer-facing page should stay anonymous, drop `author_name` and
`author_avatar_url` from the function's response — the page falls back to
initials on its own.

If you later want these links to be private again, the shape to go back to is a
per-ticket random token in place of the number — `/i/ACME/8f2c1a4b…`. That was
the original design: an unguessable `public_token` column on `issues`, dropped
before go-live because nothing read it any more.

## The embeddable form

There is one form per project, at **`/embed/{key}/form`**. It needs no login,
and the key in the path decides which project the request is filed against —
the form never asks and never guesses.

```html
<iframe src="https://support.yourcompany.com/embed/ACME/form"
        width="100%" height="900" style="border:0"></iframe>
```

The project's name appears above the form as a quiet label, so the requester can
see they're in the right place. A key that matches no project shows a message
saying so instead of a form whose submissions would go nowhere.

The **link button** on the Projects page copies a project's embed URL.

### Pre-filling fields

Any field can be supplied as a query parameter. What happens next depends on
which field it is:

- **Submission details** — `company`, `requester_name`, `requester_email`,
  `source_url` — are filled in and **removed from the form**. You already know
  who is asking; the requester shouldn't have to retype it.
- **Everything else** — type, product, area, priority, title, description — is
  **pre-filled but stays visible and editable**. A suggested type or priority is
  a starting point, and the person reporting the problem is usually the one who
  knows whether it's right.

```html
<iframe src="https://support.yourcompany.com/embed/ACME/form?product=Mobile%20App&company=Acme&email=jane@acme.com"
        width="100%" height="760" style="border:0"></iframe>
```

That form asks for everything about the request — with Product pre-selected as
"Mobile App" and changeable — while quietly recording the company and email.

| Parameter | Aliases | Fills | Hidden when supplied |
|---|---|---|:--:|
| `type` | | Type | — |
| `product` | | Product | — |
| `area` | | Area | — |
| `priority` | | Priority | — |
| `title` | `subject` | Title | — |
| `description` | `body` | Description | — |
| `company` | `org`, `company_code`, `code` | Company — **by name or, better, by code** (`?company=wupi`) | ✅ |
| `requester_name` | `name` | Requester name | ✅ |
| `requester_email` | `email` | Requester email | ✅ |
| `source_url` | `url` | Source URL | ✅ |

Values for `type`, `product`, `area` and `priority` must match the names on the
**Configuration** page exactly — matching is case-sensitive, and an unrecognised
value is stored as-is rather than rejected. URL-encode everything
(`encodeURIComponent`).

`company` is the exception: it matches a company's **code** or its name, ignoring
case, and the ticket is stored under that company's display name. Codes are short
and stable, so `?company=wupi` is the right thing to put in an embed snippet — it
survives the customer being renamed.

A section disappears only when all of its fields are gone, so supplying all four
submission parameters removes the "Submission details" block entirely.

**Source URL** has one extra wrinkle. Supply it explicitly and it hides like the
other submission fields. Omit it and the field is pre-filled with the embedding
page's URL but stays visible — an auto-detected guess is not the same as
something you asserted, so the requester can see and correct it.

Attachments: PDF or image, up to 5 files, 10MB each — enforced in the browser and
again by the storage bucket.

## Notes

- **Roles.** `admin` manages projects, users, configuration lists and saved
  views, and can delete issues. `member` works the issues of the projects they
  belong to. Roles are global; project membership decides which tickets you see.
- **Attachments are private.** The bucket is not public; the app hands out
  60-second signed URLs when someone opens a file.
- **Avatars are public**, deliberately — see *Your profile*. Only the owner can
  write one; everywhere else shows it read-only.
- **The public ticket page shows comment author avatars.** The `public-issue`
  allow-list sends the author's name and photo URL — never their id or email.
- **Deleting a configuration item** doesn't rewrite issues already using it — they
  keep the value. Toggle *Active* off instead to retire an option gracefully.
- `public/_redirects` (Netlify) and `vercel.json` are included so deep links like
  `/embed/ACME/form` and `/i/ACME/42` resolve on static hosting.
