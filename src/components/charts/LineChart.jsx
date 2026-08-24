import { useState } from 'react'
import { Box } from '@mui/material'
import dayjs from 'dayjs'
import { CHART } from './palette'
import { useContainerWidth } from './useContainerWidth'
import ChartTooltip from './ChartTooltip'

const PAD = { top: 10, right: 16, bottom: 24, left: 36 }

/** Axis ticks land on 1 / 2 / 5 × a power of ten, so they read as round numbers. */
function niceTicks(max, count = 4) {
  const rough = Math.max(max, 1) / count
  const pow = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].find((m) => m * pow >= rough) * pow
  const top = Math.ceil(Math.max(max, 1) / step) * step
  return { top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) }
}

const LABEL_FORMAT = { day: 'D MMM', week: 'D MMM', month: 'MMM YY' }

/**
 * Counts over time, one to a few series on a single y-axis.
 *
 * Deliberately never a second axis: two scales on one plot make the reader
 * see a relationship that only exists in how the axes were aligned.
 */
export default function LineChart({ data, series, unit = 'day', height = 220 }) {
  const [wrapRef, width] = useContainerWidth()
  const [hover, setHover] = useState(null)

  const plotW = Math.max(width - PAD.left - PAD.right, 10)
  const plotH = height - PAD.top - PAD.bottom
  const max = Math.max(...data.flatMap((d) => series.map((s) => d[s.key])), 0)
  const { top, ticks } = niceTicks(max)

  const x = (i) => PAD.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW)
  const y = (v) => PAD.top + plotH - (v / top) * plotH

  // Show about five x labels however many buckets there are.
  const labelEvery = Math.max(1, Math.ceil(data.length / 5))

  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left
    const i = data.length === 1 ? 0
      : Math.round(((px - PAD.left) / plotW) * (data.length - 1))
    const clamped = Math.min(Math.max(i, 0), data.length - 1)
    setHover(clamped)
  }

  return (
    <Box ref={wrapRef} sx={{ position: 'relative' }}>
      <svg width="100%" height={height} role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} y1={y(t)} x2={PAD.left + plotW} y2={y(t)}
              stroke={CHART.grid} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="central"
              fontSize={11} fill={CHART.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {t.toLocaleString()}
            </text>
          </g>
        ))}

        {data.map((d, i) => (i % labelEvery === 0 || i === data.length - 1) && (
          <text key={d.ms} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : 'middle'}
            fontSize={11} fill={CHART.muted}>
            {dayjs(d.ms).format(LABEL_FORMAT[unit] ?? 'D MMM')}
          </text>
        ))}

        {hover != null && (
          <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={PAD.top + plotH}
            stroke={CHART.grid} strokeWidth={1} />
        )}

        {series.map((s) => (
          <g key={s.key}>
            <path
              d={data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d[s.key])}`).join(' ')}
              fill="none" stroke={s.color} strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round"
            />
            {/* End marker, ringed in the surface colour so crossing lines stay legible. */}
            <circle cx={x(data.length - 1)} cy={y(data[data.length - 1][s.key])} r={4}
              fill={s.color} stroke={CHART.surface} strokeWidth={2} />
            {hover != null && (
              <circle cx={x(hover)} cy={y(data[hover][s.key])} r={4}
                fill={s.color} stroke={CHART.surface} strokeWidth={2} />
            )}
          </g>
        ))}

        <rect x={0} y={0} width={Math.max(width, 1)} height={height} fill="transparent"
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>

      {hover != null && (
        <ChartTooltip
          x={x(hover)} y={PAD.top + plotH / 2} width={width}
          title={dayjs(data[hover].ms).format(unit === 'month' ? 'MMMM YYYY' : 'D MMM YYYY')}
          rows={series.map((s) => ({ label: s.label, value: data[hover][s.key], color: s.color }))}
        />
      )}
    </Box>
  )
}
