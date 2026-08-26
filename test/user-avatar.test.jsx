/**
 * A person looks the same everywhere.
 *
 * The photo someone uploads on /profile has to reach every place a person is
 * drawn — header, board card, Issues grid, the assignee picker's options *and*
 * its closed field, comments, project members, the Users table. These check the
 * shared component's rule, then that the two hardest sites actually use it: a
 * DataGrid cell (which had only a text value) and a Select (which shows the
 * option list and the selected value through different code paths).
 */
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/issues')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { AuthContext } = await import('../src/context/AuthContext')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const { ProjectProvider } = await import('../src/context/ProjectContext')
const { FIXTURES } = await import('./mockSupabase.js')
const UserAvatarMod = await import('../src/components/UserAvatar')
const UserAvatar = UserAvatarMod.default
const { UserChip } = UserAvatarMod

const { check, done } = reporter()

const [ada, grace] = FIXTURES.profiles
const D = dom.window.document

const mount = async (node) => {
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}><MemoryRouter>{node}</MemoryRouter></ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
  return el
}

// ---- the shared component ----
const withPhoto = await mount(<UserAvatar user={ada} size={32} />)
const img = withPhoto.querySelector('img')
check('renders the uploaded photo', img?.getAttribute('src') === ada.avatar_url,
  img?.getAttribute('src') ?? '(no img)')
check('photo is labelled with the name', img?.getAttribute('alt') === 'Ada Lovelace',
  img?.getAttribute('alt'))

const noPhoto = await mount(<UserAvatar user={grace} size={32} />)
check('falls back to initials', noPhoto.textContent.trim() === 'GH', noPhoto.textContent)
check('no broken image when there is no photo', !noPhoto.querySelector('img'))

const nobody = await mount(<UserAvatar user={null} />)
check('unassigned draws a question mark', nobody.textContent.trim() === '?', nobody.textContent)

const chip = await mount(<UserChip user={ada} />)
check('chip shows the photo', Boolean(chip.querySelector('img')))
check('chip shows the name', chip.textContent.includes('Ada Lovelace'), chip.textContent)
const emptyChip = await mount(<UserChip user={null} empty="—" />)
check('chip honours its empty label', emptyChip.textContent.includes('—'), emptyChip.textContent)

// ---- the Issues grid: a cell that used to be text only ----
const Issues = (await import('../src/pages/Issues')).default
const authed = (profile, children) => (
  <AuthContext.Provider value={{ session: {}, profile, loading: false }}>
    <ConfigProvider><ProjectProvider>{children}</ProjectProvider></ConfigProvider>
  </AuthContext.Provider>
)
const grid = await mount(authed(ada, <Issues />))
const gridImgs = [...grid.querySelectorAll('img')].map((i) => i.getAttribute('src'))
check('assignee cell shows the photo', gridImgs.includes(ada.avatar_url),
  gridImgs.join(', ') || '(none)')
check('assignee cell keeps the name beside it',
  grid.textContent.includes('Ada Lovelace'), grid.textContent.slice(0, 300))

// A DataGrid cell is taller than the chip, so the chip has to be told to fill
// the row — otherwise it hangs off the top of it.
const assigneeCell = [...grid.querySelectorAll('[role="gridcell"]')]
  .find((c) => c.textContent.includes('Ada Lovelace'))
const chipInCell = assigneeCell?.querySelector('.MuiStack-root')
const chipStyle = chipInCell && dom.window.getComputedStyle(chipInCell)
check('assignee chip fills the row height', chipStyle?.height === '100%',
  chipStyle?.height ?? '(no chip found)')
check('assignee chip centres on that height', chipStyle?.alignItems === 'center',
  chipStyle?.alignItems ?? '')

// ---- the assignee picker: options and the closed field ----
const IssueDetail = (await import('../src/components/IssueDetail')).default
await mount(authed(ada,
  <IssueDetail issueId="issue-1" open onClose={() => {}} onSaved={() => {}} />))

// The dialog portals to body; issue-1 is assigned to Ada, so the closed field
// must already be showing her face without the list ever being opened.
const field = [...D.querySelectorAll('.MuiSelect-select')]
  .find((n) => n.textContent.includes('Ada Lovelace'))
check('selected assignee shows in the closed field', Boolean(field), 'no field found')
check('closed field shows the photo, not just the name',
  Boolean(field?.querySelector('img')), field?.innerHTML?.slice(0, 200) ?? '')

await act(async () => { field?.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true })) })
await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
const options = [...D.querySelectorAll('[role="option"]')]
check('picker lists the roster', options.length >= 2, String(options.length))
const adaOption = options.find((o) => o.textContent.includes('Ada Lovelace'))
check('an option with a photo shows it', Boolean(adaOption?.querySelector('img')),
  adaOption?.innerHTML?.slice(0, 200) ?? '(no option)')
const graceOption = options.find((o) => o.textContent.includes('Grace Hopper'))
check('an option without a photo falls back to initials',
  graceOption?.textContent.includes('GH'), graceOption?.textContent ?? '(no option)')

// ---- the Users table: avatars, but view only ----
// Who may change a photo is settled in storage: the `avatars` policy requires
// the object's first folder to be the caller's own uid. So this page shows a
// face per row and offers nobody — not even an admin — a way to replace one.
const Users = (await import('../src/pages/Users')).default
const usersPage = await mount(authed(ada, <Users />))
const rows = [...usersPage.querySelectorAll('tbody tr')]
check('lists the roster', rows.length >= 2, String(rows.length))
check('every row has an avatar',
  rows.every((r) => r.querySelector('.MuiAvatar-root')),
  rows.map((r) => r.textContent.slice(0, 30)).join(' | '))
check('a user with a photo shows it',
  rows.some((r) => r.querySelector(`img[src="${ada.avatar_url}"]`)),
  [...usersPage.querySelectorAll('img')].map((i) => i.src).join(', ') || '(none)')
check('a user without one shows initials',
  rows.some((r) => r.textContent.includes('GH')),
  rows.map((r) => r.textContent.slice(0, 40)).join(' | '))
check('no upload control on the roster',
  usersPage.querySelectorAll('input[type="file"]').length === 0)
check('no avatar wording that implies editing here',
  !/change photo|upload photo/i.test(usersPage.textContent))

done()
