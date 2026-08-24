import Chip from '@mui/material/Chip'
import { stringColor } from '../lib/format'

/** A colour-coded chip; colour comes from Configuration, falling back to a hash. */
export default function Tag({ value, color, size = 'small', variant = 'filled', ...rest }) {
  if (!value) return null
  const c = color ?? stringColor(value)
  return (
    <Chip
      label={value}
      size={size}
      variant={variant}
      sx={{
        bgcolor: variant === 'filled' ? `${c}1f` : 'transparent',
        color: c,
        border: `1px solid ${c}55`,
        ...rest.sx,
      }}
      {...rest}
    />
  )
}
