import { cn } from '../cn'

export type Tone = 'neutral' | 'workspace' | 'session' | 'global' | 'scope' | 'agent' | 'legacy' | 'diff' | 'summary'

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-[var(--text-dim)]',
  workspace: 'bg-[var(--color-accent)]',
  session: 'bg-[var(--color-accent-session)]',
  global: 'bg-[var(--color-accent-global)]',
  scope: 'bg-[var(--color-accent-scope)]',
  agent: 'bg-[var(--color-accent-agent)]',
  legacy: 'bg-[var(--color-accent-legacy)]',
  diff: 'bg-[var(--color-accent-diff)]',
  summary: 'bg-[var(--color-accent-summary)]',
}

const TONE_BAR: Record<Tone, string> = {
  neutral: 'bg-[var(--text-dim)]',
  workspace: 'bg-[var(--color-accent)]',
  session: 'bg-[var(--color-accent-session)]',
  global: 'bg-[var(--color-accent-global)]',
  scope: 'bg-[var(--color-accent-scope)]',
  agent: 'bg-[var(--color-accent-agent)]',
  legacy: 'bg-[var(--color-accent-legacy)]',
  diff: 'bg-[var(--color-accent-diff)]',
  summary: 'bg-[var(--color-accent-summary)]',
}

export interface SegmentedBarSegment {
  label: string
  value: number
  tone?: Tone
}

export interface SegmentedBarProps {
  segments: SegmentedBarSegment[]
  className?: string
  showLegend?: boolean
}

export function SegmentedBar({ segments, className, showLegend = true }: SegmentedBarProps) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0)

  return (
    <div className={className}>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-fill)]">
        <div className="flex h-full gap-px">
          {segments.map((segment, index) => {
            const percent = total > 0 ? (Math.max(0, segment.value) / total) * 100 : 0
            if (percent < 0.5) {
              return null
            }
            const tone = segment.tone ?? pickTone(index)
            return (
              <div
                key={`${segment.label}:${segment.value}:${tone}`}
                className={cn('h-full shrink-0', TONE_BAR[tone])}
                style={{ width: `${Math.min(100, percent)}%` }}
                title={`${segment.label}: ${segment.value}`}
              />
            )
          })}
        </div>
      </div>
      {showLegend
        ? (
          <div className="mt-2 grid grid-cols-1 gap-x-8 gap-y-px md:grid-cols-2">
            {segments.map((segment, index) => {
              const tone = segment.tone ?? pickTone(index)
              const share = total > 0
                ? `${Math.round((Math.max(0, segment.value) / total) * 100)}%`
                : '0%'
              return (
                <div
                  key={`legend:${segment.label}:${segment.value}:${tone}`}
                  className="grid min-h-7 grid-cols-[minmax(0,1fr)_72px_44px] items-center gap-2 rounded-md px-1.5 text-[12px]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[tone])} />
                    <span className="truncate text-[var(--text-primary)]">{segment.label}</span>
                  </div>
                  <span className="text-right tabular-nums text-[var(--text-secondary)]">
                    {formatCompactNumber(segment.value)}
                  </span>
                  <span className="text-right tabular-nums text-[var(--text-tertiary)]">{share}</span>
                </div>
              )
            })}
          </div>
        )
        : null}
    </div>
  )
}

function pickTone(index: number): Tone {
  const tones: Tone[] = ['workspace', 'session', 'summary', 'scope', 'legacy', 'agent', 'global', 'diff', 'neutral']
  return tones[index % tones.length]!
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return value.toLocaleString('en-US')
}
