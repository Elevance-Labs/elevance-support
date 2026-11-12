import { useTheme } from '@mui/material/styles'

/**
 * Chart colours.
 *
 * Three separate jobs, three separate sets — a colour never crosses over:
 *
 *   CATEGORICAL  identity  (which series is this?)   assigned in slot order, never cycled
 *   ORDINAL      order     (which band is this?)     one hue, light to dark
 *   SLA bands    state     (is this ticket in trouble?)  reserved, from src/lib/sla.js
 *
 * The slot order is the colourblind-safety mechanism, not decoration: it was
 * validated for CVD separation against the light chart surface. Take colours
 * from the front of the list and stop at eight — a ninth series folds into
 * "Other" instead of inventing a hue.
 */

export const CATEGORICAL = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
]

/** Single hue, light to dark, for ordered bands like ticket age. */
export const ORDINAL = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281']

export const SERIES_1 = CATEGORICAL[0]
export const SERIES_2 = CATEGORICAL[1]

/** Chrome: recessive by design, so the data is the only loud thing on screen. */
export const CHART = {
  surface: '#ffffff',
  grid: '#e5e7eb',
  ink: '#111827',
  muted: '#6b7280',
}

export const seriesColor = (i) => CATEGORICAL[i % CATEGORICAL.length]

/** The chrome on a dark surface: the same jobs, lifted off the dark paper. */
const CHART_DARK = {
  surface: '#1b1d23',
  grid: 'rgba(255, 255, 255, 0.12)',
  ink: '#f3f4f6',
  muted: '#9ca3af',
}

/** The chart chrome for the theme in use (light or dark). */
export function useChartChrome() {
  return useTheme().palette.mode === 'dark' ? CHART_DARK : CHART
}
