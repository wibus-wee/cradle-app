import { cn } from '~/lib/cn'

export interface AutomationDetailValueProps {
  label: string
  value: string
  mono?: boolean
}

export function AutomationDetailValue({
  label,
  value,
  mono,
}: AutomationDetailValueProps) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          'truncate text-right text-xs text-foreground',
          mono && 'font-mono',
        )}
      >
        {value}
      </span>
    </div>
  )
}
