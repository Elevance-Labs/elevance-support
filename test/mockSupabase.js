const LIST_ITEMS = [
  { id: '1', list_type: 'type',     name: 'Bug',        color: '#d32f2f', sort_order: 1, is_active: true },
  { id: '2', list_type: 'type',     name: 'Question',   color: '#7b1fa2', sort_order: 2, is_active: true },
  { id: '3', list_type: 'product',  name: 'Mobile App', color: null,      sort_order: 1, is_active: true },
  { id: '4', list_type: 'area',     name: 'Billing',    color: null,      sort_order: 1, is_active: true },
  { id: '5',  list_type: 'priority', name: 'High',     color: '#f57c00', sort_order: 1, is_active: true },
  { id: '11', list_type: 'priority', name: 'Medium',   color: '#fbc02d', sort_order: 2, is_active: true },
  { id: '12', list_type: 'priority', name: 'Retired',  color: null,      sort_order: 0, is_active: false },
  // Severities carry a behaviour — the sentence the dropdown shows beside the
  // name, and the ticket does not — and the SLA target, which is what the
  // sentence means in hours. Moderate deliberately has none, so "a severity
  // with no target" is still something the tests can render.
  { id: '17', list_type: 'severity', name: 'Critical', color: '#b71c1c', sort_order: 1, is_active: true,
    behavior: 'Service is down. Work starts immediately.', sla_hours: 8 },
  { id: '18', list_type: 'severity', name: 'Moderate', color: '#f9a825', sort_order: 2, is_active: true,
    behavior: 'There is a workaround. Scheduled into the current queue.' },
  { id: '19', list_type: 'severity', name: 'Shelved',  color: null,      sort_order: 3, is_active: false,
    behavior: 'No longer offered.' },
  { id: '6', list_type: 'status',   name: 'New',         color: null, sort_order: 1, is_active: true, status_type: 'new' },
  { id: '7', list_type: 'status',   name: 'Triaged',     color: null, sort_order: 2, is_active: true, status_type: 'in_progress' },
  { id: '8', list_type: 'status',   name: 'In Progress', color: null, sort_order: 3, is_active: true, status_type: 'in_progress' },
  { id: '9',  list_type: 'status',  name: 'Done',        color: null, sort_order: 5, is_active: true, status_type: 'closed' },
  { id: '13', list_type: 'status',  name: 'On Hold',     color: null, sort_order: 4, is_active: true, status_type: 'paused' },
  { id: '10', list_type: 'labels',  name: 'regression',  color: '#d32f2f', sort_order: 1, is_active: true },
  // 'Form' is stamped by the database and must never be offered to staff.
  { id: '14', list_type: 'source',  name: 'Form',        color: '#1976d2', sort_order: 1, is_active: true },
  { id: '15', list_type: 'source',  name: 'Email',       color: '#7b1fa2', sort_order: 2, is_active: true },
  { id: '16', list_type: 'source',  name: 'Call',        color: '#f57c00', sort_order: 5, is_active: true },
]
export const PROJECTS = [
  { id: 'proj-1', name: 'Acme Support', key: 'ACME', status: 'in_progress', issue_seq: 42 },
  { id: 'proj-2', name: 'Billing',      key: 'BILL', status: 'incoming',    issue_seq: 0 },
]

// Companies are a list, not a text box. `Old Free Text Ltd` is deliberately NOT
// here: it only exists on an old ticket, which the filters must still reach.
export const COMPANIES = [
  { id: 'co-1', name: "Wilbert's U-Pull-It", code: 'wupi', is_active: true },
  { id: 'co-2', name: 'Acme',                code: 'acme', is_active: true },
  { id: 'co-3', name: 'Former Customer',     code: 'former', is_active: false },
]

export const PROJECT_MEMBERS = [
  { project_id: 'proj-1', user_id: 'user-1' },
  { project_id: 'proj-1', user_id: 'user-2' },
  { project_id: 'proj-1', user_id: 'user-3' },
]

/**
 * The support rota: one range that has run, one running now, one still ahead.
 *
 * Anchored to the day the suite runs rather than to fixed dates, because which
 * group a schedule falls into — and, since managers only reach the live ones,
 * who may edit it — is a question about today. Fixed dates would quietly all
 * become "past" and stop testing the rule.
 */
export const dayKey = (offset) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

export const SCHEDULE_DAYS = {
  pastStart: dayKey(-30), pastEnd: dayKey(-24),
  liveStart: dayKey(-2),  liveEnd: dayKey(4),
  nextStart: dayKey(10),  nextEnd: dayKey(16),
}

export const PROJECT_SCHEDULES = [
  { id: 'sch-past', project_id: 'proj-1',
    starts_on: SCHEDULE_DAYS.pastStart, ends_on: SCHEDULE_DAYS.pastEnd,
    assignee_ids: ['user-1'], created_by: 'user-1' },
  { id: 'sch-live', project_id: 'proj-1',
    starts_on: SCHEDULE_DAYS.liveStart, ends_on: SCHEDULE_DAYS.liveEnd,
    assignee_ids: ['user-1', 'user-2'], created_by: 'user-1' },
  { id: 'sch-next', project_id: 'proj-1',
    starts_on: SCHEDULE_DAYS.nextStart, ends_on: SCHEDULE_DAYS.nextEnd,
    assignee_ids: ['user-2'], created_by: 'user-1' },
]

export const captured = {
  inserts: [], updates: [], deletes: [], uploads: [], removals: [], auth: [], functionCalls: [],
}
/**
 * A thenable query builder that actually applies `eq` and `in`.
 *
 * Filtering matters rather than being pedantry: the app scopes every read to
 * one project, and a mock that ignored `.eq('project_id', …)` would hand back
 * the same rows however the page was filtered — so a test could never catch
 * scoping being dropped.
 */
const chain = (data) => {
  const rows = data ?? []
  const p = Promise.resolve({ data: rows, error: null })
  p.select = () => chain(rows)
  p.order = () => chain(rows)
  p.eq = (col, value) => chain(rows.filter((r) => r[col] === value))
  p.in = (col, values) => chain(rows.filter((r) => (values ?? []).includes(r[col])))
  // Only the `is null` / `not is null` forms the app uses.
  p.is = (col, value) => chain(rows.filter((r) => (r[col] ?? null) === value))
  p.not = (col, op, value) => op === 'is'
    ? chain(rows.filter((r) => (r[col] ?? null) !== value)) : chain(rows)
  p.single = () => Promise.resolve({ data: rows[0] ?? {}, error: null })
  p.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  return p
}
/**
 * What a write resolves to: one affected row, whatever was filtered.
 *
 * Separate from `chain` because a write's `.eq()` says which row to change, not
 * which of the returned rows to keep — and the app reads the returned rows to
 * tell a write row-level security refused (zero rows, no error) from one that
 * landed. A test that wants the refusal simulates it with `refuseWrites`.
 */
const writeChain = (row) => {
  const rows = refuseWrites.on ? [] : [row]
  const p = Promise.resolve({ data: rows, error: null })
  p.select = () => writeChain(row)
  p.order = () => writeChain(row)
  p.eq = () => writeChain(row)
  p.in = () => writeChain(row)
  p.single = () => Promise.resolve({ data: rows[0] ?? {}, error: null })
  p.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  return p
}

/** Flip on to make every write come back having changed nothing, as RLS does. */
export const refuseWrites = { on: false }

const tableData = (table) => {
  if (table === 'list_items') return LIST_ITEMS
  if (table === 'issues') return FIXTURES.issues
  if (table === 'status_events') return FIXTURES.status_events
  if (table === 'comments') return FIXTURES.comments
  if (table === 'profiles') return FIXTURES.profiles
  if (table === 'projects') return PROJECTS
  if (table === 'project_members') return PROJECT_MEMBERS
  if (table === 'project_schedules') return PROJECT_SCHEDULES
  if (table === 'companies') return COMPANIES
  if (table === 'attachments') return FIXTURES.attachments
  return []
}

export const supabase = {
  from(table) {
    return {
      select: () => chain(tableData(table)),
      insert: (row) => { captured.inserts.push({ table, row }); return writeChain({ id: 'new-issue' }) },
      update: (row) => { captured.updates.push({ table, row }); return writeChain({ id: 'updated' }) },
      // Hands back the rows it matched, as `.delete().eq(…).select()` does, and
      // records which table it was asked of.
      delete: () => { captured.deletes.push({ table }); return chain(tableData(table)) },
    }
  },
  auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    // The Profile page proves the current password before changing it, so both
    // calls are recorded: a test can assert the order they happened in.
    signInWithPassword: async ({ email, password }) => {
      captured.auth.push({ call: 'signInWithPassword', email, password })
      return password === CURRENT_PASSWORD
        ? { data: { user: FIXTURES.profiles[0] }, error: null }
        : { data: null, error: { message: 'Invalid login credentials' } }
    },
    updateUser: async (attrs) => {
      captured.auth.push({ call: 'updateUser', ...attrs })
      return { data: { user: FIXTURES.profiles[0] }, error: null }
    },
  },
  storage: {
    from: (bucket) => ({
      upload: async (path, file, opts) => {
        captured.uploads.push({ bucket, path, type: file?.type, size: file?.size, opts })
        return { error: null }
      },
      remove: async (paths) => {
        captured.removals.push({ bucket, paths })
        return { data: paths.map((name) => ({ name })), error: null }
      },
      createSignedUrl: async (path) => ({
        data: { signedUrl: `https://signed.example/${path}` }, error: null,
      }),
      createSignedUrls: async (paths) => ({
        data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })), error: null,
      }),
      getPublicUrl: (path) => ({
        data: { publicUrl: `https://public.example/${bucket}/${path}` },
      }),
    }),
  },
  // Stands in for the `public-issue` edge function. `functionCalls` lets a test
  // assert the browser asked for the key and number from the URL, and nothing else.
  functions: {
    invoke: async (name, { body } = {}) => {
      captured.functionCalls.push({ name, body })
      if (name !== 'public-issue') return { data: null, error: new Error('unknown function') }
      // The pair has to match: the same number under a different project key is
      // a different ticket, or none at all.
      if (body?.number !== PUBLIC_NUMBER || body?.key !== PUBLIC_KEY) {
        return { data: null, error: Object.assign(new Error('not_found'), { context: { status: 404 } }) }
      }
      return { data: PUBLIC_PAYLOAD, error: null }
    },
  },
}
export const isConfigured = true

/** The only password `signInWithPassword` accepts, so a test can get it wrong. */
export const CURRENT_PASSWORD = 'correct-horse'

// ---- extra fixtures for the ticket detail view ----
export const NOW = Date.now()
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()
const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000

export const FIXTURES = {
  // A second project's ticket, so a page that forgot to scope its read would
  // show a row it has no business showing.
  otherIssue: {
    id: 'issue-2', ref: 43, number: 1, project_id: 'proj-2',
    title: 'Invoice PDF is blank', description: 'Nothing renders.',
    type: 'Bug', product: 'Mobile App', area: 'Billing', priority: 'High',
    // Deliberately untriaged: a New ticket that cannot yet be started.
    severity: null,
    status: 'New', assignee_ids: [], labels: [], jira_ticket: null,
    company: 'Globex', requester_name: 'Sam', requester_email: 'sam@globex.com',
    source_url: null, submitted_date: iso(1 * DAY),
  },
  issue: {
    id: 'issue-1', ref: 42, number: 42, project_id: 'proj-1',
    title: 'Cannot export invoice',
    description: 'The export button spins forever.',
    type: 'Bug', product: 'Mobile App', area: 'Billing', priority: 'High',
    // The snapshot the database stamps at insert: the same values here, so a
    // test that changes `product` is changing it away from what was submitted.
    submitted_type: 'Bug', submitted_product: 'Mobile App', submitted_area: 'Billing',
    submitted_priority: 'High',
    severity: 'Critical',
    status: 'In Progress', assignee_ids: ['user-1'], labels: ['regression'],
    jira_ticket: 'ENG-77', notes: 'Reproduced on staging.',
    company: 'Acme', requester_name: 'Jane', requester_email: 'jane@acme.com',
    source_url: 'https://acme.com/billing', submitted_date: iso(3 * DAY),
  },
  status_events: [
    { id: 'e1', issue_id: 'issue-1', from_status: null, to_status: 'New',
      changed_by: null, created_at: iso(3 * DAY) },
    { id: 'e2', issue_id: 'issue-1', from_status: 'New', to_status: 'Triaged',
      changed_by: 'user-1', created_at: iso(2 * DAY) },
    { id: 'e3', issue_id: 'issue-1', from_status: 'Triaged', to_status: 'In Progress',
      changed_by: 'user-2', created_at: iso(5 * HR) },
  ],
  comments: [
    { id: 'c1', issue_id: 'issue-1', author_id: 'user-1', body: 'Looking into this.',
      created_at: iso(2 * DAY), updated_at: iso(2 * DAY) },
    { id: 'c2', issue_id: 'issue-1', author_id: 'user-2', body: 'Just posted.',
      created_at: iso(30_000), updated_at: iso(30_000) },
  ],
  // One file on the request, and one on Grace's fresh comment — so the dialog
  // and the thread each have to pick out their own.
  attachments: [
    { id: 'att-1', issue_id: 'issue-1', comment_id: null, file_name: 'report.pdf',
      file_path: 'issue-1/att-1-report.pdf', mime_type: 'application/pdf', size_bytes: 2048,
      created_at: iso(3 * DAY) },
    { id: 'att-2', issue_id: 'issue-1', comment_id: 'c2', file_name: 'staging.png',
      file_path: 'issue-1/att-2-staging.png', mime_type: 'image/png', size_bytes: 4096,
      created_at: iso(30_000) },
  ],
  profiles: [
    // Ada has uploaded a photo; Grace has not — so every avatar site is exercised
    // in both states by the same fixture list.
    //
    // Departments are picked so the pair rule has something to say: Ada and
    // Grace can be assigned together, Kay cannot join Ada — she is the second
    // engineer.
    { id: 'user-1', full_name: 'Ada Lovelace', email: 'ada@co.com', role: 'admin', is_active: true,
      department: 'Engineering',
      avatar_url: 'https://public.example/avatars/user-1/avatar?v=1' },
    // Deliberately nameless — mirrors an account created from the Supabase
    // dashboard, which is what made emails show up in the UI.
    { id: 'user-2', full_name: '', email: 'grace.hopper@co.com', role: 'member', is_active: true,
      department: 'Quality', avatar_url: null },
    { id: 'user-3', full_name: 'Kay Antonelli', email: 'kay@co.com', role: 'member', is_active: true,
      department: 'Engineering', avatar_url: null },
  ],
}

// ---- the share-link payload the `public-issue` edge function returns ----
FIXTURES.issues = [FIXTURES.issue, FIXTURES.otherIssue]

// The share link's address: the ticket reference, split into its two parts.
export const PUBLIC_KEY = PROJECTS[0].key           // 'ACME'
export const PUBLIC_NUMBER = FIXTURES.issue.number  // 42

export const PUBLIC_PAYLOAD = {
  project: { name: 'Acme Support', key: 'ACME' },
  issue: {
    number: 42,
    title: 'Cannot export invoice',
    description: 'The export button spins forever.',
    company: 'Acme',
    jira_ticket: 'ENG-77',
    submitted_date: iso(3 * DAY),
  },
  attachments: [
    { id: 'a1', file_name: 'screenshot.png', mime_type: 'image/png',
      url: 'https://signed.example/issue-1/screenshot.png' },
  ],
  // Names only — the function never sends an author id or email.
  // The function sends a name and a photo URL — no id, no email. Ada has a
  // photo, Grace does not, so the page is exercised both ways.
  comments: [
    { id: 'c1', body: 'Looking into this.', created_at: iso(2 * DAY),
      author_name: 'Ada Lovelace',
      author_avatar_url: 'https://public.example/avatars/user-1/avatar?v=1' },
    { id: 'c2', body: 'Just posted.', created_at: iso(30_000),
      author_name: 'Grace Hopper', author_avatar_url: null,
      attachments: [
        { id: 'a2', file_name: 'staging.png', mime_type: 'image/png',
          url: 'https://signed.example/issue-1/staging.png' },
      ] },
  ],
}
