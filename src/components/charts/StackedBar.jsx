import { useId, useState } from 'react'
import { Box } from '@mui/material'
import { useContainerWidth } from './useContainerWidth'
import ChartTooltip from './ChartTooltip'
import Legend from './Legend'

const GAP = 2   // the surface itself does the separating — never a border on the mark

/**
 * One bar split into its parts: a proportion at a glance, with the counts in
 * the legend underneath so nobody has to estimate a segment by eye.
 *
 * A segment is only labelled in place when the number genuinely fits, because a
 * clipped label is worse than none.
 */
export default function StackedBar({ data, height = 24, unit = 'tickets' }) {
  const [wrapRef, width] = useContainerWidth()
  const [hover, setHover] = useState(null)
  const clipId = useId()

  const total = data.reduce((n, d) => n + d.value, 0)
  const shown = data.filter((d) => d.value > 0)
  const gaps = Math.max(shown.length - 1, 0) * GAP
  const usable = Math.max(width - gaps, 1)

  const segments = shown.reduce((acc, d) => {
    const previous = acc[acc.length - 1]
    const w = (d.value / total) * usable
    acc.push({ ...d, x: previous ? previous.x + previous.w + GAP : 0, w })
    return acc
  }, [])

  return (
    <Box>
      <Box ref={wrapRef} sx={{ position: 'relative' }}>
        <svg width="100%" height={height} role="img">
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={Math.max(width, 1)} height={height} rx={4} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            {segments.map((s) => (
              <g key={s.name}>
                <rect x={s.x} y={0} width={s.w} height={height} fill={s.color}
                  opacity={hover && hover.name !== s.name ? 0.45 : 1}
                  onMouseEnter={() => setHover({ ...s, cx: s.x + s.w / 2 })}
                  onMouseLeave={() => setHover(null)} />
                {s.w > 34 && (
                  <text x={s.x + s.w / 2} y={height / 2} textAnchor="middle" dominantBaseline="central"
                    fontSize={11} fontWeight={600} fill="#ffffff" pointerEvents="none">
                    {s.value}
                  </text>
                )}
              </g>
            ))}
          </g>
        </svg>
        {hover && (
          <ChartTooltip x={hover.cx} y={height / 2} width={width} title={hover.name}
            rows={[
              { label: unit, value: hover.value, color: hover.color },
              { label: 'share', value: `${Math.round((hover.value / total) * 100)}%` },
            ]} />
        )}
      </Box>
      <Legend sx={{ mt: 1.5 }}
        items={data.map((d) => ({ label: d.name, color: d.color, value: d.value }))} />
    </Box>
  )
}
