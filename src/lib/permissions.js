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
