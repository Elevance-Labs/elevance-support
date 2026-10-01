/**
 * Single source of truth for what each role may do.
 *
 * admin   — everything
 * manager — everything a member can do, plus: manage saved views, see reports,
 *           reset passwords for managers/members, disable managers/members.
 *           Cannot create or delete accounts, cannot touch admins.
 * member  — work issues on the Issues and Board pages, load (not manage) views,
 *           comment. Cannot delete tickets.
 *
 * Roles are global, not per project: a manager is a manager in every project
 * they belong to. Project membership decides *which* tickets you can see; your
 * role decides what you may do with them.
 *
 * Every rule here is mirrored by row-level security or the admin-users function;
 * this module exists to keep the UI honest, not to be the only guard.
 */

import { toMillis } from './format'
import { hasAssignees } from './assignees'
import { toDateKey } from './schedules'

export const ROLES = ['admin', 'manager', 'member']

export const ROLE_LABELS = {
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
}

export const ROLE_DESCRIPTIONS = {
  admin: 'Full access, including deleting tickets and managing users and configuration.',
  manager: 'Manages views and reports, resets passwords and disables managers and members.',
  member: 'Works tickets on Issues and Board, uses saved views, comments.',
}

const is = (role) => (p) => p?.role === role
export const isAdmin = is('admin')
export const isManager = is('manager')
export const isManagerOrAdmin = (p) => isAdmin(p) || isManager(p)

/** How long a comment stays editable by its author. */
export const COMMENT_EDIT_WINDOW_MS = 5 * 60 * 1000

export const can = {
  // ---- tickets ----
  editIssue:   (p) => Boolean(p),
  deleteIssue: isAdmin,

  /**
   * Severity is the team's own reading of a ticket — what it costs the customer
   * and what the team therefore commits to — so only an internal user assigns
   * one. That means anyone signed in, whatever their role: severity is what
   * unlocks moving a ticket to In Progress or Paused, and members are who do
   * that work. The boundary that matters is internal vs. the public form, and
   * the database draws it by refusing a severity on an anonymous insert.
   */
  setSeverity: (p) => Boolean(p),

  /**
   * Re-filing a ticket: changing its product or area. Same boundary and the
   * same reasoning as severity — it is the team's own reading of where the
   * ticket belongs, and that reading improves as the ticket is understood, so
   * whoever is working it may correct it at any point in its life.
   *
   * Type and priority are deliberately *not* here. They are the request's own
   * account of itself, frozen by the database the moment the ticket is filed;
   * what the team makes of it goes in severity, product and area instead, and
   * `submitted_*` keeps the original either way.
   */
  refile: (p) => Boolean(p),

  /**
   * Putting people on a ticket — up to two of them.
   *
   * Picking up a ticket nobody holds is ordinary work, so anyone signed in may.
   * Changing a set that already names somebody is a different act: it takes
   * work off a colleague, or hands yours to one, and that is a scheduling
   * decision rather than a working one — so an admin or a manager.
   *
   * Which is also why the rota lives on the Projects page: assigning in bulk,
   * ahead of time, is the same decision made once instead of per ticket.
   */
  setAssignees: (p, issue) =>
    Boolean(p) && (isManagerOrAdmin(p) || !hasAssignees(issue)),

  /**
   * Seeing a project's support rota at all, and the page it lives on.
   *
   * Managers get their own route for it rather than the Projects page, which
   * stays admin-only: running the rota is not the same power as renaming or
   * deleting the project it belongs to.
   */
  seeSchedules: isManagerOrAdmin,

  /**
   * Creating a schedule. Admins and managers, any dates.
   *
   * Called with no arguments it also answers "may this person manage the rota
   * at all", which is what shows the New button.
   */
  manageSchedules: isManagerOrAdmin,

  /**
   * Editing or deleting an existing schedule.
   *
   * An admin may change any of them. A manager may change current and upcoming
   * ones — anything whose last day is today or later. Past ones are an admin's.
   *
   * "Today" is the UTC day, because that is the day row-level security judges
   * against; a local day would offer buttons the database then refuses for a
   * few hours either side of midnight. `day` exists so a test can pick one.
   */
  changeSchedule: (p, schedule, day = new Date().toISOString().slice(0, 10)) => {
    if (isAdmin(p)) return true
    if (!isManager(p)) return false
    const ends = toDateKey(schedule?.ends_on)
    return Boolean(ends) && ends >= day
  },

  // ---- saved views ----
  manageViews: isManagerOrAdmin,

  // ---- pages ----
  seeReports:  isManagerOrAdmin,
  seeUsers:    isManagerOrAdmin,
  seeConfig:   isAdmin,
  manageConfig: isAdmin,

  // ---- projects ----
  // Creating a project, re-keying who is in it and closing it are all admin
  // work. Everyone else simply works in the projects they've been added to.
  seeProjects:    isAdmin,
  manageProjects: isAdmin,

  // ---- users ----
  createUser: isAdmin,
  deleteUser: isAdmin,
  changeRole: isAdmin,

  /** Admins may reset anyone's password; managers only managers and members. */
  setPassword: (p, target) =>
    isAdmin(p) || (isManager(p) && target?.role !== 'admin'),

  /** Same rule for disabling, and nobody may disable themselves. */
  setActive: (p, target) =>
    target && p?.id !== target.id &&
    (isAdmin(p) || (isManager(p) && target.role !== 'admin')),

  editUser: (p, target) =>
    isAdmin(p) || (isManager(p) && target?.role !== 'admin'),

  // ---- comments ----
  /**
   * Authors may edit or delete their own comment for five minutes.
   * Deliberately no admin override — the same rule is enforced by RLS, and
   * loosening it here would just produce errors the user can't act on.
   */
  modifyComment: (p, comment, now = Date.now()) =>
    Boolean(p) && comment?.author_id === p.id &&
    now - toMillis(comment.created_at) < COMMENT_EDIT_WINDOW_MS,
}
