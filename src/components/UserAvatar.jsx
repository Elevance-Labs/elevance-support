import { Avatar, AvatarGroup, Box, Stack, Tooltip, Typography } from '@mui/material'
import { initials, stringColor } from '../lib/format'
import { departmentOf, displayName } from '../lib/users'

/**
 * One person, drawn the same way everywhere: their photo if they have uploaded
 * one, their initials if not.
 *
 * Every place that shows a person goes through here — the header, board cards,
 * the Issues grid, the assignee pickers, comments, the project member list and
 * the Users table. That is the point: a colleague is recognisable by the same
 * face and, failing that, the same colour, whichever page you are looking at.
 * The colour is hashed from the displayed name (see stringColor), so it is
 * stable without anything being stored.
 *
 * A photo is only ever changed by its owner, on /profile — the `avatars`
 * storage policy enforces that, so every avatar here is read-only.
 */
export default function UserAvatar({ user, name, size = 24, sx, ...rest }) {
  const label = name ?? displayName(user, '')
  const known = Boolean(user || name)

  return (
    <Avatar
      src={user?.avatar_url || undefined}
      alt={label}
      sx={{
        width: size, height: size,
        // Initials have to shrink with the circle or they spill out of it.
        fontSize: Math.max(9, Math.round(size * 0.42)),
        bgcolor: known ? stringColor(label) : 'grey.300',
        color: known ? undefined : 'text.secondary',
        ...sx,
      }}
      {...rest}
    >
      {known ? initials(label) : '?'}
    </Avatar>
  )
}

/**
 * Avatar plus name on one line — what a dropdown option, a table cell or a
 * selected field shows. `empty` is the text for "nobody", which a picker needs
 * for its Unassigned row and the grid needs for an unassigned ticket.
 */
export function UserChip({
  user, name, size = 24, empty = 'Unassigned', italicWhenEmpty = true, sx,
}) {
  const known = Boolean(user || name)
  return (
    // `sx` is how a caller gives the row a height to centre against — a DataGrid
    // cell is taller than its content, so without `height: '100%'` the chip
    // clings to the top of the row.
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0, ...sx }}>
      <UserAvatar user={user} name={name} size={size} />
      <Box sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {known ? (
          <Typography variant="body2" noWrap>{name ?? displayName(user)}</Typography>
        ) : (
          <Typography variant="body2" color="text.secondary" noWrap
            sx={italicWhenEmpty ? { fontStyle: 'italic' } : undefined}>
            {empty}
          </Typography>
        )}
      </Box>
    </Stack>
  )
}

/**
 * The people on a ticket — nobody, one, or two — on one line.
 *
 * Two names side by side do not fit a grid cell or a board card, so the second
 * person is a second face and a "+1": the faces carry who, and the tooltip
 * carries the names in full. One person reads exactly as `UserChip` does, which
 * is what most tickets are.
 */
export function AssigneeChip({
  users = [], size = 24, empty = 'Unassigned', italicWhenEmpty = true, sx,
}) {
  const present = users.filter(Boolean)
  if (present.length <= 1) {
    return (
      <UserChip user={present[0]} size={size} empty={empty}
        italicWhenEmpty={italicWhenEmpty} sx={sx} />
    )
  }

  const names = present.map((u) => displayName(u))
  return (
    <Tooltip title={names.join(' and ')}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0, ...sx }}>
        <AvatarGroup max={2} spacing="small" sx={{
          '& .MuiAvatar-root': {
            width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.42)),
          },
        }}>
          {present.map((u) => <UserAvatar key={u.id} user={u} size={size} />)}
        </AvatarGroup>
        <Box sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Typography variant="body2" noWrap>
            {names[0]} <Box component="span" sx={{ color: 'text.secondary' }}>
              +{present.length - 1}
            </Box>
          </Typography>
        </Box>
      </Stack>
    </Tooltip>
  )
}

/**
 * A person as an assignee picker lists them: face, name, and the department
 * underneath.
 *
 * The department is there because it is the thing that decides whether they can
 * be picked at all — a second assignee has to come from a different one — so it
 * belongs in the row where the choice is made rather than in a tooltip.
 */
export function UserOption({ user, size = 24 }) {
  const dept = departmentOf(user)
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0, width: '100%' }}>
      <UserAvatar user={user} size={size} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" noWrap>{displayName(user)}</Typography>
        {dept && (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {dept}
          </Typography>
        )}
      </Box>
    </Stack>
  )
}
