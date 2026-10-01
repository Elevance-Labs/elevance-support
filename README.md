# Support Tool

An in-house support intake and tracking app: a public, embeddable request form
feeding a dashboard your team works out of.

React + Vite + Material UI on the front, Supabase (Postgres, Auth, Storage) behind it.

## Pages

| Page | What it does |
|---|---|
| **Dashboard** | The selected project's open work at a glance: your own queue, the tickets closest to breaching, and where the rest of it is sitting. |
| **Issues** | Every request in a filterable table. Admins save filter sets as **views** everyone can load. |
| **Board** | Jira-style kanban by status. Drag a card between lanes to change its status. Each card leads with its ticket reference and type. |
| **Report** | Volume, breakdowns and SLA performance for the selected range. |
| **Schedule** | The selected project's support rota — who is on, and when. Managers and admins. |
| **Projects** | Admin-only CRUD over projects, their keys, their members and their **support schedule**. |
| **Users** | Admin-only CRUD over who can sign in and be assigned work, and which department they are in. |
| **Configuration** | Admin-only CRUD over the lists that drive every dropdown — types, products, areas, priorities, severities, statuses, labels and sources. |
| **Profile** | Your own account — reached from the avatar in the header. Shows your name, email and role; lets you change your photo and your password. |

## Roles

| | Member | Manager | Admin |
|---|:--:|:--:|:--:|
| Work tickets on Issues and Board | ✅ | ✅ | ✅ |
| Assign a ticket's severity | ✅ | ✅ | ✅ |
| Pick up a ticket nobody is on | ✅ | ✅ | ✅ |
| Set someone's department (managers: non-admins) | — | ✅ | ✅ |
| Change who is on an **already-assigned** ticket | — | ✅ | ✅ |
| Re-file a ticket (product, area) | ✅ | ✅ | ✅ |
| Comment (edit/delete own for 5 min) | ✅ | ✅ | ✅ |
| Load saved views | ✅ | ✅ | ✅ |
| Create / rename / delete views | — | ✅ | ✅ |
| See Reports | — | ✅ | ✅ |
| Reset passwords (managers & members) | — | ✅ | ✅ |
| Disable accounts (managers & members) | — | ✅ | ✅ |
| Reset password / disable an **admin** | — | — | ✅ |
| Create or delete accounts, change roles | — | — | ✅ |
| Create projects, set members, close them | — | — | ✅ |
| Create schedules; edit or delete current and upcoming ones | — | ✅ | ✅ |
| Edit or delete a **past** schedule | — | — | ✅ |
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
once**. The header carries a single-select project picker on every page that
shows one project's data — Dashboard, Issues, Board, Report and Schedule — and
hides it on the rest, where it would change nothing. There is no "all projects"
option, because a combined view would be a view of data the viewer may not be
entitled to hold in one place.

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
| **Schedule** | Who is on support, and when. See [The support schedule](#the-support-schedule). |

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

### The support schedule

Most tickets should not need assigning by hand. A project keeps a **rota**: a
date range and the one or two people on support for it. When a request arrives,
the database finds the schedule covering its **submitted date** and puts those
people on the ticket.

It has a page of its own — **Schedule** in the nav — showing the selected
project's rota. Admins can also open it from the calendar button on a project's
row on the Projects page; it is the same thing either way. The page exists
because Projects is admin-only, and running the rota is not the same power as
renaming or deleting the project those tickets belong to.

Schedules are grouped the way a rota is read — **On now**, **Coming up**,
**Past** — and past ones are kept, because they are the answer to "who had this
ticket in January".

| | |
|---|---|
| **From / To** | Inclusive at both ends. A one-day rota has the same date twice. |
| **On support** | One or two people, from different [departments](#departments). |

A rota carries the same department rule a ticket does — it is where most pairs
come from, and one naming two engineers would mint tickets that break the rule.
If somebody moves department after a rota is written, that schedule is flagged
*"Both in Engineering"* in this dialog, and a ticket arriving in its range is
assigned **only the first of the two** rather than failing to file: a customer's
request must never be lost to an HR change.

#### Who may change one

| | Member | Manager | Admin |
|---|:--:|:--:|:--:|
| See the rota (projects you belong to) | ✅ | ✅ | ✅ |
| Create a schedule, any dates | — | ✅ | ✅ |
| Edit or delete a **current or upcoming** schedule | — | ✅ | ✅ |
| Edit or delete a **past** schedule | — | — | ✅ |

A schedule is past once its last day is behind us — both ends count, so one
ending today is still current. The day is taken in **UTC**, the same day the
assignment trigger uses. A manager only reaches the rotas of projects they
belong to.

For a manager, past rows show a padlock instead of edit and delete buttons.
Row-level security enforces the rule, and because RLS refuses an update by
matching no rows rather than by raising, the page checks what came back and
says *"Nothing was saved"* rather than reporting a success that changed nothing.

**Two schedules in a project may never cover the same day.** Otherwise "who is
on today" would have two answers and the trigger would quietly pick one. The
dialog names the schedule in the way before you can save — *"12 Jan 2026 – 18 Jan
2026 is already covered by Ada Lovelace and Grace Hopper"* — and a database
exclusion constraint refuses the overlap however the row arrives.

Three things worth knowing about how a schedule reaches a ticket:

- It reads **`submitted_date`, not the time of the insert**. A ticket you log by
  hand against last Tuesday lands on whoever was on last Tuesday. Public
  submissions have their date pinned to now by a trigger, so they always land on
  today's pair.
- It **only ever fills an empty set**. A ticket created with someone already on
  it keeps them.
- Days are compared in **UTC** — a rota boundary has to fall on the same day for
  everyone reading the schedule.

Deleting a schedule does not touch tickets it already assigned; those people
were genuinely on them.

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

- **Left** — three blocks, in the order a ticket is read.
  **Submission** is how it reached us: company, requester, channel, when.
  **Request** is the customer's own account of the problem — **type** and
  **priority** exactly as submitted and not editable at all — followed by
  **severity**, the one judgement the team adds to it.
  **Details** is everything the team decides for itself and may keep changing:
  **product**, **area**, **labels** and **Jira**. Product and area say
  *"Submitted as …"* underneath once they no longer match what arrived.
  The **Jira** field takes a pasted Jira link as happily as a typed key: whatever
  you paste is reduced to the ticket key (`ENG-1234`) when you leave the field
  and again when you save, so the "Open in Jira" link is always well formed.
  Text with no key in it is left exactly as you wrote it.
- **Centre** — **assignees and status side by side** at the top — the assignee
  picker shows each person's photo and holds **up to two** of them, and the
  status picker a coloured dot for the status *type*, the same dot the board
  columns use — then the description,
  then the **comment** thread with the composer beneath the existing comments.
  Anyone signed in can comment; the author can edit or delete their own comment
  for **5 minutes**, after which the buttons disappear on their own. The
  5-minute rule is enforced by row-level security too, so it can't be bypassed
  via the API. **Ctrl+Enter** (or **Cmd+Enter**) posts the comment, and saves an
  edit in progress; plain Enter is still a newline, since the box is multi-line.
  **Escape** cancels an edit.
  A comment can carry **files** — images, PDFs or video, under the same limits
  as a request (see *Embedding the form*) — picked with the paperclip or pasted
  into the box as a screenshot. A comment may be just a file. The files show
  under their comment, not with the request's own. Only the author may add or
  remove a comment's files, and only inside the same 5-minute window; deleting
  the comment takes its files with it. Row-level security enforces all three.
- **Right** — the **status timeline**: the statuses this ticket has actually been
  through, in order, showing who moved it there, when, and how long it sat in the
  previous status. Statuses it never reached are not drawn. Total elapsed time
  sits at the top.

The **link button** in the header copies a public share link for the ticket —
see [Share links](#share-links) below.

New tickets automatically start at the first status in sort order, and every
status change is recorded by a database trigger — so tickets submitted through
the public form get a timeline too.

## Departments

Everyone belongs to exactly one of five departments:

**Product · Design · Support · Engineering · Quality**

It is a **fixed list**, not a Configuration one. Types, severities and statuses
are vocabulary the team tunes; departments are the shape of the organisation, so
they live in a check constraint on `profiles.department`, a constant in
[`src/lib/users.js`](src/lib/users.js) and a mirror of it in the `admin-users`
function. Adding a sixth is a migration and two edits, deliberately.

A department is set on the **Users** page, by an admin — or by a manager, for
managers and members, the same boundary as editing anything else about an
account. You cannot change your own: a database trigger pins it back on a
self-write, alongside role, email and active status, because your department
decides who you can be paired with and that is the team's call rather than
yours. Your own shows read-only on [your profile](#your-profile).

Every account has one. Accounts that existed before departments did were
backfilled to **Support**, and an account created straight from the Supabase
dashboard gets the same default — a placeholder so the rule below is enforceable
from day one, not a finding. Correct them on the Users page.

## Assignees

A ticket carries **up to two people**. Two, because support here is worked in
pairs — someone holding it and someone who can pick it up — and a list with no
ceiling is a list nobody owns. Both names count equally: a shared ticket is on
both their Dashboard queues, matches both their filters on Issues and Board, and
counts for both in the *By assignee* breakdown (which is why that breakdown's
shares can add past 100%, and says so). The order is still a decision — the
first name is who it is mainly on.

**The two must come from two different [departments](#departments).** A pair is
meant to be two readings of the same problem — engineering and quality, support
and product — so two people from one department is not a pair, it is the same
reading twice. One assignee is always fine; the rule only has anything to say
about a second.

The picker enforces it by closing options rather than by complaining after the
fact: each person's department is shown under their name, and once somebody is
on the ticket everyone else from their department greys out. Anyone already on
it stays clickable, or there would be no way to take them off. The chips read
*"Ada Lovelace · Engineering"*, so a pair is legible as two departments without
looking anyone up. A database trigger refuses a same-department pair however the
update arrives, on tickets and on schedules alike.

One wrinkle worth knowing: the rule is checked when the assignee set is
**written**, not continuously. If somebody moves department afterwards, a pair
that was valid stays on its ticket — rewriting history is not the answer — but
the field says *"Both are in Engineering"*, and the next real change to that
ticket's assignees has to fix it.

Most tickets are assigned before anyone opens them, by the project's
[support schedule](#the-support-schedule). The ticket is where that gets
corrected.

**Picking up a ticket nobody is on is ordinary work**, so anyone signed in may.
**Changing a set that already names somebody is not** — it takes work off a
colleague, or hands yours to one — so that is an admin or a manager. The picker
goes read-only for a member on an assigned ticket and says why rather than just
sitting there dead. Taking yourself off a ticket is the same act, and gets the
same answer.

**A ticket cannot leave a New status with nobody on it.** The status dropdown
offers nothing to move to, the field says *"Assign someone before moving this
ticket on"*, and a database trigger refuses the update however it arrives.
Unlike the severity gate, this one **does** cover Closed: a request can be
rejected without ever being triaged, but somebody did the rejecting and the
ticket should say who.

Where a ticket shows two people, there is only room for one name — the Issues
grid, board cards and the Dashboard lists draw both faces and read
*"Ada Lovelace +1"*, with both names in the tooltip. Sorting and export still
run off the names, so the column means what it says.

Deleting an account takes it off the tickets it was on, rather than leaving an
id that resolves to nobody.

## Severity

**Priority is how the requester ranks it. Severity is how *we* read it** — what
the problem costs the customer, and what the team therefore commits to. So a
severity is not just a label: each one carries a **behaviour**, one sentence
saying what picking it means, and the **SLA target** that sentence is worth in
hours. Picking a severity is therefore the moment the ticket acquires a deadline
— see [SLAs](#statuses-status-types-and-slas) below.

| | Where it shows |
|---|---|
| Name + behaviour | in the severity dropdown, wherever one is chosen |
| Name only | on the ticket, on the Issues grid, on board cards |

The behaviour is read at the moment the promise is made; afterwards the name is
the answer and the sentence would only be noise. Severities are managed on
**Configuration → Severities** — name, behaviour and SLA target together, which
is the point: the sentence and the number say the same thing to two different
readers. The database refuses a severity with no behaviour, because one without
it is just a second priority list, and it refuses an SLA target on anything that
is not a severity.

**Only an internal user assigns a severity.** That means anyone signed in,
whatever their role — severity is what unlocks starting work, and members are
who start work. The public embed form neither shows nor sends one: an anonymous
submission has whatever it claims dropped by a trigger, and severity is not in
the `public-issue` allow-list, so it never reaches a customer-facing page
either.

**A ticket cannot be started or paused until it has one.** Moving to a status of
type **In Progress** or **Paused** is refused while severity is empty — the
dropdown doesn't offer those statuses, a board card says "Not triaged", and the
database raises if the update arrives anyway. **Closed is deliberately not
gated**: a request can always be answered or rejected outright without being
triaged first. Tickets that predate the rule keep a blank severity and are left
alone until someone tries to move them.

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

**SLA targets are set per severity** (Configuration → Severities), in hours —
the commitment belongs to what the ticket costs the customer, not to what kind
of request it is. The clock starts when the ticket is **submitted** and **stops
the moment the ticket reaches a status of type Closed** — `issues.closed_at` is
stamped by a trigger. Triage does not restart it: an untriaged ticket is already
counting, against no target, and the moment a severity is assigned that target
applies to the whole elapsed time. Being slow to triage therefore costs exactly
what it costs.

| Band | Consumed | Colour |
|---|---|---|
| On track | under 40% | 🔵 blue |
| Watch | 40% – 70% | 🟡 yellow |
| At risk | 70% – 100% | 🟠 orange |
| SLA breached | over 100% | 🔴 red |
| No SLA | — | the ticket is untriaged, or its severity has no target set |

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

**What a ticket arrived as is kept separately from what it is worked as.** At
insert a trigger stamps `submitted_type`, `submitted_product`, `submitted_area`
and `submitted_priority` from whatever the request carried, and nothing ever
writes them again — not even an admin.

From there:

- **Type and priority cannot be changed at all.** They are the request's own
  account of itself; the team records its own reading in severity, product and
  area instead. The ticket shows them with a padlock.
- **Product and area can be changed by anyone signed in, at any point** in the
  ticket's life — filing is a judgement that improves as the ticket is
  understood, and the snapshot above is what makes correcting it safe.

Every one of those rules is a trigger, not just a disabled field. Tickets
created before the snapshot existed carry null `submitted_*` values: that means
*unknown*, not *unchanged*, and reports must leave them out rather than count
them as never re-filed.

**A ticket sitting in a New status is offered no New status to move to.** The
status dropdown withholds them, so opening a New ticket and saving it as New
takes deliberate effort: the choices on the table are to triage it and start, to
park it, or to answer it outright. The database still permits New → New — a
ticket has to be able to wait in the queue — so this is a nudge where the
decision is being made, not a rule.

**An untriaged ticket cannot move into In Progress or Paused** at all — see
[Severity](#severity) above. That rule sits on top of the ladder rather than
replacing it: assigning a severity never unlocks a move backwards.

## Dashboard

Everyone's landing point for **one project's open work**. Everything on it
counts **only tickets that are not done** — a closed ticket has no queue
position, no running clock and no share of what is left — so a tile and a
breakdown on the page always add up to the same number — with one stated
exception, the *By assignee* breakdown, below.

- **Tiles** — open tickets, how many are assigned to you, how many have used
  75% or more of their SLA target, how many are unassigned, and how many are
  still untriaged.
- **My issues** — your open tickets — including the ones you are the *second*
  name on — with their severity and the time on their
  SLA clock, the most of a target consumed first. Untriaged tickets sort last:
  nothing has been promised about them yet, so they cannot be more urgent than
  something that has. The clock is SLA-elapsed, not age — a pause stops it.
- **Breaching SLA** — open tickets that have used **75% or more** of their
  target, worst first, with the percentage consumed. That is deliberately
  tighter than the 70% *At risk* band: the band is a colour on a ticket you are
  already looking at, this is a list you are meant to work through. An untriaged
  ticket is never on it — with no severity there is no target, and a ticket
  cannot be late for a promise nobody made.
- **Breakdowns** — open tickets by status (in the configured workflow order, not
  by size), by assignee (unassigned included, because that is the slice worth
  acting on) and by severity (untriaged gets its own grey slice). Each bar
  carries its count and its share of the open queue. A ticket on
  [two people](#assignees) counts for **both** — it is work on both their plates
  — so that one breakdown can add past 100%, and its subtitle says how many
  tickets are shared rather than leaving the arithmetic to look wrong.

Click any row to open the ticket. Both lists cap at eight rows and say how many
more they are holding back. The maths lives in
[`src/lib/dashboard.js`](src/lib/dashboard.js) as plain functions, covered by
[`test/dashboard.test.js`](test/dashboard.test.js).

## Reports

Managers and admins get a read-only report over **one project's** tickets,
filtered by **range** (7 / 30 / 90 days or all time), and optionally by type and
product.
Everything on the page is derived from the same rows, so a tile, a chart and a
table can never disagree.

- **Tiles** — submitted, still open, closed, median time to close, and the
  percentage that met SLA. The SLA figure is measured **only over tickets whose
  severity has a target**; counting untriaged or untargeted tickets as met would
  flatter it.
- **Volume over time** — submitted against closed, bucketed by day, week or
  month depending on how long the range is. Quiet buckets are drawn as zero
  rather than skipped.
- **Breakdowns** — open tickets by status (in the configured workflow order),
  and tickets by request type, product and area. Past the top few, the tail is
  grouped as **Other** instead of growing the chart.
- **Age of open tickets** — how long the open queue has been waiting, in bands.
- **Priority mix** and **SLA position of open tickets** — one bar each, split
  into its parts, with the counts spelled out in the legend.
- **SLA performance by severity** — target, volume, breaches, met % and median
  time to close, per severity. Grouped by severity because that is where the
  target lives, so every ticket in a row was committed to the same thing and the
  met % is a statement about one promise. Untriaged tickets get a row of their
  own, with no target and no percentage.
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
trigger pins `role`, `is_active`, `email` and `department` back to their old
values on any self-write by a non-admin, so that policy cannot be used from the
browser to promote yourself, or to move yourself into a department you would
rather be paired from — the `admin-users` function stays the only writer of
`role`.

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

Because you are logging somebody else's request, the internal form asks for five
things the public form doesn't:

| Field | Why |
|---|---|
| **Source** | Which channel it arrived through — Email, IM, SMS, Call, Internal. Editable under Configuration → Sources. |
| **Severity** | The team's own reading of the request — see [Severity](#severity). Optional here, since triage can happen later, but the ticket can't be started without it. |
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
so an attachment URL can't be guessed even though the ticket URL can. That
includes files attached to **comments**: the comments are on the page, so what
was attached to them is too. Don't attach anything to a comment you wouldn't
write in one.

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

Attachments: PDF, image or video, up to 5 files. An image or PDF may be 10MB, a
video 30MB — the browser applies the per-type limit, the storage bucket enforces
the 30MB outer bound and the list of accepted types.

A screenshot can also be **pasted straight into the Description** box: the image
becomes an attachment (named `pasted-…`) instead of being dropped, while pasting
ordinary text behaves as it always did. Videos are picked with the button.

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
  `/embed/ACME/form` and `/i/ACME/42` resolve on static hosting. GitHub Pages has
  no rewrite rules, so `.github/workflows/pages.yml` copies `index.html` to
  `404.html` instead — the same trick by another door.
- **GitHub Pages** builds from that workflow on every push to `main`. A project
  site is served from `/<repo>/`, so the workflow passes `VITE_BASE`, which sets
  Vite's base, the router's `basename` and the prefix on embed and share links.
  Drop `VITE_BASE` if you move to a custom domain or an `<org>.github.io` repo,
  which are served from the root. Build-time config comes from repository
  *variables* (Settings -> Secrets and variables -> Actions -> Variables), not
  secrets: everything `VITE_*` is compiled into the bundle and public anyway.
  Whatever the URL ends up being, add it to Supabase's Site URL / redirect list
  and set the `notify-issue` function's `APP_BASE_URL` to match, sub-path included.
