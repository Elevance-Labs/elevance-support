const LIST_ITEMS = [
  { id: '1', list_type: 'type',     name: 'Bug',        color: '#d32f2f', sort_order: 1, is_active: true, sla_hours: 8 },
  { id: '2', list_type: 'type',     name: 'Question',   color: '#7b1fa2', sort_order: 2, is_active: true },
  { id: '3', list_type: 'product',  name: 'Mobile App', color: null,      sort_order: 1, is_active: true },
  { id: '4', list_type: 'area',     name: 'Billing',    color: null,      sort_order: 1, is_active: true },
  { id: '5',  list_type: 'priority', name: 'High',     color: '#f57c00', sort_order: 1, is_active: true },
  { id: '11', list_type: 'priority', name: 'Medium',   color: '#fbc02d', sort_order: 2, is_active: true },
  { id: '12', list_type: 'priority', name: 'Retired',  color: null,      sort_order: 0, is_active: false },
  { id: '6', list_type: 'status',   name: 'New',         color: null, sort_order: 1, is_active: true, status_type: 'new' },
  { id: '7', list_type: 'status',   name: 'Triaged',     color: null, sort_order: 2, is_active: true, status_type: 'in_progress' },
  { id: '8', list_type: 'status',   name: 'In Progress', color: null, sort_order: 3, is_active: true, status_type: 'in_progress' },
  { id: '9',  list_type: 'status',  name: 'Done',        color: null, sort_order: 5, is_active: true, status_type: 'closed' },
  { id: '13', list_type: 'status',  name: 'On Hold',     color: null, sort_order: 4, is_active: true, status_type: 'paused' },
  { id: '10', list_type: 'labels',  name: 'regression',  color: '#d32f2f', sort_order: 1, is_active: true },
]
export const PROJECTS = [
  { id: 'proj-1', name: 'Acme Support', key: 'ACME', status: 'in_progress', issue_seq: 42 },
  { id: 'proj-2', name: 'Billing',      key: 'BILL', status: 'incoming',    issue_seq: 0 },
]

export const PROJECT_MEMBERS = [
  { project_id: 'proj-1', user_id: 'user-1' },
  { project_id: 'proj-1', user_id: 'user-2' },
]

export const captured = { inserts: [], functionCalls: [] }
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
  p.single = () => Promise.resolve({ data: rows[0] ?? {}, error: null })
  p.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  return p
}
const tableData = (table) => {
  if (table === 'list_items') return LIST_ITEMS
  if (table === 'issues') return FIXTURES.issues
  if (table === 'status_events') return FIXTURES.status_events
  if (table === 'comments') return FIXTURES.comments
  if (table === 'profiles') return FIXTURES.profiles
  if (table === 'projects') return PROJECTS
  if (table === 'project_members') return PROJECT_MEMBERS
  return []
}

export const supabase = {
  from(table) {
    return {
      select: () => chain(tableData(table)),
      insert: (row) => { captured.inserts.push({ table, row }); return chain([{ id: 'new-issue' }]) },
      update: () => chain([]), delete: () => chain([]),
    }
  },
  auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  storage: {
    from: () => ({
      upload: async () => ({ error: null }),
      createSignedUrl: async (path) => ({
        data: { signedUrl: `https://signed.example/${path}` }, error: null,
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
    status: 'New', assignee_id: null, labels: [], jira_ticket: null,
    company: 'Globex', requester_name: 'Sam', requester_email: 'sam@globex.com',
    source_url: null, submitted_date: iso(1 * DAY),
  },
  issue: {
    id: 'issue-1', ref: 42, number: 42, project_id: 'proj-1',
    title: 'Cannot export invoice',
    description: 'The export button spins forever.',
    type: 'Bug', product: 'Mobile App', area: 'Billing', priority: 'High',
    status: 'In Progress', assignee_id: 'user-1', labels: ['regression'],
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
  profiles: [
    { id: 'user-1', full_name: 'Ada Lovelace', email: 'ada@co.com', role: 'admin', is_active: true },
    // Deliberately nameless — mirrors an account created from the Supabase
    // dashboard, which is what made emails show up in the UI.
    { id: 'user-2', full_name: '', email: 'grace.hopper@co.com', role: 'member', is_active: true },
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
  comments: [
    { id: 'c1', body: 'Looking into this.', created_at: iso(2 * DAY), author_name: 'Ada Lovelace' },
    { id: 'c2', body: 'Just posted.', created_at: iso(30_000), author_name: 'Grace Hopper' },
  ],
}
