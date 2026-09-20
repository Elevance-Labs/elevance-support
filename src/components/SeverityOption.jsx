import { Stack, Typography } from '@mui/material'
import Tag from './Tag'

/**
 * How a severity reads in the two places it appears.
 *
 * A severity is a promise, not just a label: "Critical" means nothing on its
 * own, and the sentence that gives it meaning is set beside it on the
 * Configuration page. So the open dropdown shows the name *and* that sentence —
 * the promise is read at the moment it is made — while the closed field shows
 * only the name, because by then the choice has been made and the row is one
 * field among many.
 */
export function SeverityOption({ item }) {
  if (!item) return null
  return (
    <Stack spacing={0.25} sx={{ py: 0.25, minWidth: 0 }}>
      <Tag value={item.name} color={item.color} />
      {item.behavior && (
        <Typography
          variant="caption" color="text.secondary"
          // Menu items don't wrap by default, and the behaviour is a sentence.
          sx={{ whiteSpace: 'normal', maxWidth: 360 }}
        >
          {item.behavior}
        </Typography>
      )}
    </Stack>
  )
}

/**
 * The chosen severity, as it reads once the dropdown is closed: the name alone.
 *
 * Not triaged is a state of its own and says so, rather than leaving an empty
 * box — a ticket without a severity is one that cannot be started, which is
 * worth reading at a glance.
 */
export function SeverityValue({ severities = [], name }) {
  if (!name) {
    return (
      <Typography variant="body2" color="text.disabled" component="span">
        Not triaged
      </Typography>
    )
  }
  const item = severities.find((s) => s.name === name)
  return <Tag value={name} color={item?.color} />
}

export default SeverityOption
