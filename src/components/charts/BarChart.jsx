import { useState } from 'react'
import { Box } from '@mui/material'
import { CHART, SERIES_1 } from './palette'
import { useContainerWidth } from './useContainerWidth'
import ChartTooltip from './ChartTooltip'

const ROW = 30
const BAR = 16      // thin marks; the leftover of the row band is deliberate air
const RADIUS = 4    // rounded at the data end, square against the baseline

/** A bar grown from the baseline, rounded only at the end the data reaches. */
function barPath(x, y, w, h, r = RADIUS) {
  if (w <= r) return `M${x},${y} h${Math.max(w, 1)} v${h} h${-Math.max(w, 1)} Z`
  return `M${x},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r}`
    + ` v${h - r * 2} a${r},${r} 0 0 1 ${-r},${r} h${-(w - r)} Z`
}

/**
 * Horizontal bars for "how many per category", biggest first.
 *
 * One colour for the whole series by default — length already encodes the
 * magnitude, so tinting each bar by its own value would spend the colour
 * channel on information the chart is showing twice. Pass a per-datum `color`
 * only when the categories are genuinely ordered (age bands), where the ramp
 * carries the order.
 */
export default function BarChart({
  data, color = SERIES_1, formatValue = (v) => v.toLocaleString(), tooltipLabel = 'Tickets',
}) {
  const [wrapRef, width] = useContainerWidth()
  const [hover, setHover] = useState(null)

  const longest = data.reduce((n, d) => Math.max(n, d.name.length), 0)
  const labelW = Math.min(150, Math.max(72, longest * 6.6))
  const valueW = 44
  const plotW = Math.max(width - labelW - valueW - 8, 10)
  const max = Math.max(...data.map((d) => d.value), 1)
  const height = data.length * ROW

  return (
    <Box ref={wrapRef} sx={{ position: 'relative' }}>
      <svg width="100%" height={height} role="img">
        {/* Baseline: one hairline, a single step off the surface. */}
        <line x1={labelW} y1={0} x2={labelW} y2={height} stroke={CHART.grid} strokeWidth={1} />
        {data.map((d, i) => {
          const y = i * ROW
          const barY = y + (ROW - BAR) / 2
          const w = (d.value / max) * plotW
          const fill = d.color ?? color
          return (
            <g key={d.name}>
              <text x={labelW - 8} y={y + ROW / 2} textAnchor="end" dominantBaseline="central"
                fontSize={12} fill={CHART.muted}>
                {d.name.length > 22 ? `${d.name.slice(0, 21)}…` : d.name}
              </text>
              <path d={barPath(labelW, barY, w, BAR)} fill={fill}
                opacity={hover && hover.name !== d.name ? 0.45 : 1} />
              <text x={labelW + w + 8} y={y + ROW / 2} dominantBaseline="central"
                fontSize={12} fontWeight={600} fill={CHART.ink}>
                {formatValue(d.value)}
              </text>
              {/* Hit target is the whole row, not the bar — a 3px bar is unhoverable. */}
              <rect x={0} y={y} width={Math.max(width, 1)} height={ROW} fill="transparent"
                onMouseEnter={() => setHover({ ...d, x: labelW + w, y: y + ROW / 2 })}
                onMouseLeave={() => setHover(null)} />
            </g>
          )
        })}
      </svg>
      {hover && (
        <ChartTooltip x={hover.x} y={hover.y} width={width} title={hover.name}
          rows={[{ label: tooltipLabel, value: formatValue(hover.value), color: hover.color ?? color }]} />
      )}
    </Box>
  )
}
