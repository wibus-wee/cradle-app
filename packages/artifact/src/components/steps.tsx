import { CheckLine } from '@mingcute/react'

import { cn } from '../cn'

export interface StepItem {
  label: string
  status: 'done' | 'current' | 'upcoming'
}

export interface StepsProps {
  steps: StepItem[]
  className?: string
}

/** Horizontal workflow indicator: numbered/check markers joined by a rail. */
export function Steps({ steps, className }: StepsProps) {
  return (
    <ol className={cn('flex items-start', className)}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1
        return (
          <li key={step.label} className={cn('flex min-w-0', !isLast && 'flex-1')}>
            <div className="flex min-w-0 flex-col items-center gap-1.5">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] tabular-nums',
                  'transition-colors duration-[var(--duration-quick)] ease-[var(--ease-standard)]',
                  {
                    'bg-[var(--viz-blue)] text-white': step.status === 'current',
                    'text-[var(--success)] shadow-[inset_0_0_0_1px_var(--border)]': step.status === 'done',
                    'text-[var(--text-dim)] shadow-[inset_0_0_0_1px_var(--border)]': step.status === 'upcoming',
                  },
                )}
                aria-current={step.status === 'current' ? 'step' : undefined}
              >
                {step.status === 'done' ? <CheckLine className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'max-w-full truncate px-1 text-[11px]',
                  {
                    'font-medium text-[var(--foreground)]': step.status === 'current',
                    'text-[var(--muted-foreground)]': step.status !== 'current',
                  },
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast
              ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-3 h-px w-full min-w-6',
                      step.status === 'done' ? 'bg-[var(--viz-blue)]' : 'bg-[var(--border)]',
                    )}
                  />
                )
              : null}
          </li>
        )
      })}
    </ol>
  )
}
