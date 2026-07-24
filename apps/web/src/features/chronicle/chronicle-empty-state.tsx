import type { ReactNode } from 'react'

export interface ChronicleEmptyStateProps {
  icon: ReactNode
  title: string
}

export function ChronicleEmptyState({
  icon,
  title,
}: ChronicleEmptyStateProps) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-foreground/10 bg-muted/20 px-4 py-6 text-muted-foreground">
      <div className="flex items-center gap-2 text-[13px]">
        {icon}
        <span>{title}</span>
      </div>
    </div>
  )
}
