import { reporter } from './setup.js'
import { can, COMMENT_EDIT_WINDOW_MS } from '../src/lib/permissions.js'
import { duration } from '../src/lib/format.js'

const { check, done } = reporter()

const admin   = { id: 'a', role: 'admin' }
const manager = { id: 'm', role: 'manager' }
const member  = { id: 'u', role: 'member' }

const tAdmin   = { id: 'a2', role: 'admin' }
const tManager = { id: 'm2', role: 'manager' }
const tMember  = { id: 'u2', role: 'member' }

// ---- ticket deletion: admin only ----
check('admin deletes tickets',        can.deleteIssue(admin))
check('manager cannot delete tickets', !can.deleteIssue(manager))
check('member cannot delete tickets',  !can.deleteIssue(member))

// ---- views: manager and admin ----
check('admin manages views',   can.manageViews(admin))
check('manager manages views', can.manageViews(manager))
check('member cannot manage views', !can.manageViews(member))

// ---- reports ----
check('manager sees reports', can.seeReports(manager))
check('member cannot see reports', !can.seeReports(member))

// ---- configuration: admin only ----
check('admin manages config', can.manageConfig(admin))
check('manager cannot manage config', !can.manageConfig(manager))

// ---- user creation/deletion: admin only ----
check('admin creates users',           can.createUser(admin))
check('manager cannot create users',   !can.createUser(manager))
check('manager cannot delete users',   !can.deleteUser(manager))
check('manager cannot change roles',   !can.changeRole(manager))

// ---- passwords: manager may reset managers and members, never admins ----
check('admin resets admin password',      can.setPassword(admin, tAdmin))
check('manager resets member password',   can.setPassword(manager, tMember))
check('manager resets manager password',  can.setPassword(manager, tManager))
check('manager cannot reset admin password', !can.setPassword(manager, tAdmin))
check('member cannot reset passwords',    !can.setPassword(member, tMember))

// ---- disabling ----
check('admin disables manager',            can.setActive(admin, tManager))
check('manager disables member',           can.setActive(manager, tMember))
check('manager disables manager',          can.setActive(manager, tManager))
check('manager cannot disable admin',      !can.setActive(manager, tAdmin))
check('nobody disables themselves',        !can.setActive(admin, admin))
check('manager cannot disable self',       !can.setActive(manager, manager))
check('member cannot disable anyone',      !can.setActive(member, tMember))

// ---- comments: own, within 5 minutes ----
const now = Date.now()
const mine  = (ageMs) => ({ author_id: member.id, created_at: new Date(now - ageMs).toISOString() })
const other = (ageMs) => ({ author_id: 'someone', created_at: new Date(now - ageMs).toISOString() })

check('own comment editable at 1 min',   can.modifyComment(member, mine(60_000), now))
check('own comment editable at 4m59s',   can.modifyComment(member, mine(COMMENT_EDIT_WINDOW_MS - 1000), now))
check('own comment locked at 5m01s',     !can.modifyComment(member, mine(COMMENT_EDIT_WINDOW_MS + 1000), now))
check('exactly 5m is locked (boundary)', !can.modifyComment(member, mine(COMMENT_EDIT_WINDOW_MS), now))
check("cannot edit someone else's",      !can.modifyComment(member, other(1000), now))
check('admin gets no override',          !can.modifyComment(admin, other(1000), now))

// ---- duration formatting used by the timeline ----
const MIN = 60_000, HR = 3_600_000, DAY = 86_400_000
check('duration 30s',    duration(now - 30_000, now) === '30s',           duration(now - 30_000, now))
check('duration 45m',    duration(now - 45 * MIN, now) === '45m',         duration(now - 45 * MIN, now))
check('duration 5h 20m', duration(now - (5 * HR + 20 * MIN), now) === '5h 20m', duration(now - (5*HR+20*MIN), now))
check('duration 3d 4h',  duration(now - (3 * DAY + 4 * HR), now) === '3d 4h',   duration(now - (3*DAY+4*HR), now))
check('duration exact days drops 0h', duration(now - 3 * DAY, now) === '3d',    duration(now - 3*DAY, now))
check('negative clamps to 0s', duration(now + 5000, now) === '0s',        duration(now + 5000, now))
check('null is em dash',       duration(null) === '—')

done()
