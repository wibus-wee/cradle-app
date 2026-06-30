import { cn } from '~/lib/cn'

import type { LabelTone } from './label-metadata'
import { getLabelTone } from './label-metadata'

const labelToneClasses: Record<LabelTone, string> = {
  blue: 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  green: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  amber: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  rose: 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  violet: 'border-violet-500/20 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  cyan: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  slate: 'border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300',
}

export function LabelChip({ label, className, tone }: { label: string, className?: string, tone?: LabelTone }) {
  const resolvedTone = tone ?? getLabelTone(label)

  return (
    <span className={cn(
      'inline-flex h-4 items-center rounded px-1.5 text-[11px] font-medium',
      'border',
      labelToneClasses[resolvedTone],
      className,
    )}
    >
      {label}
    </span>
  )
}
