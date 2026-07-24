import type { ReactNode } from 'react'

export interface ChronicleStatusItemViewProps {
  icon: ReactNode
  label: string
  value: string
  detail?: string
}

export function ChronicleStatusItemView({
  icon,
  label,
  value,
  detail,
}: ChronicleStatusItemViewProps) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px]">{label}</span>
      </div>
      <span className="mt-1 block truncate text-[13px] font-medium tabular-nums text-foreground">
        {value}
      </span>
      {detail && (
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/70">
          {detail}
        </span>
      )}
    </div>
  )
}
