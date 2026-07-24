export interface AutomationSectionLabelProps {
  label: string
  count?: number
}

export function AutomationSectionLabel({
  label,
  count,
}: AutomationSectionLabelProps) {
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {count !== undefined && (
        <span className="rounded-full bg-muted/60 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      )}
      <div className="h-px flex-1 bg-border/40" />
    </div>
  )
}
