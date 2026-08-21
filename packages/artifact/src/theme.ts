import type { CSSProperties } from 'react'

/**
 * Tokens injected at the artifact root. Visualization colors resolve to
 * adaptive app tokens so charts follow light/dark without extra logic.
 */
export const ARTIFACT_THEME_STYLE = {
  '--viz-blue': 'var(--info)',
  '--duration-quick': '120ms',
  '--ease-standard': 'cubic-bezier(0.22, 1, 0.36, 1)',
} as CSSProperties

/** Chart palette for multi-series visualizations (donut segments, stacked series). */
export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!
}
