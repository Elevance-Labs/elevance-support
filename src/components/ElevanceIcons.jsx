import { createSvgIcon } from '@mui/material/utils'

// The Elevance suite's app marks, drawn from the company logo's two shapes
// (the thick quarter-ring and the slanted-top block). Same shape as the app
// icons in public/icons, so the header, the switcher and the home screen agree.
export const WorkIcon = createSvgIcon(
  <path
    d="M112,205 L196,183 L196,249 L112,249 Z M112,285 L196,263 L196,329 L112,329 Z M214,165 L298,143 L298,209 L214,209 Z M214,245 L298,223 L298,289 L214,289 Z M214,325 L298,303 L298,369 L214,369 Z M316,205 L400,183 L400,249 L316,249 Z M316,285 L400,263 L400,329 L316,329 Z "
    transform="scale(0.07143) translate(-88 -88)"
  />,
  'Work',
)

export const SupportIcon = createSvgIcon(
  <path
    d="M128,236 A128,128 0 0 1 384,236 L340,236 A84,84 0 0 0 172,236 Z M112,236 h76 v80 h-76 Z M324,236 h76 v80 h-76 Z M376,316 A84,84 0 0 1 292,400 L292,362 A46,46 0 0 0 338,316 Z M246,374 L292,362 L292,400 L246,400 Z"
    transform="scale(0.07143) translate(-88 -88)"
  />,
  'Support',
)

export const PeopleIcon = createSvgIcon(
  <path
    d="M208,196 A48,48 0 1 0 304,196 A48,48 0 1 0 208,196 Z M166,366 A90,90 0 0 1 346,366 Z M79,244 A34,34 0 1 0 147,244 A34,34 0 1 0 79,244 Z M365,244 A34,34 0 1 0 433,244 A34,34 0 1 0 365,244 Z M76,366 A74,74 0 0 1 150,292 L150,366 Z M362,292 A74,74 0 0 1 436,366 L362,366 Z"
    transform="scale(0.06122) translate(-60 -61)"
  />,
  'People',
)
