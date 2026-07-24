export interface GroupHeaderProps {
  label: string
  count?: number
}

export function GroupHeader({ label, count }: GroupHeaderProps) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 pt-2.5 pb-1">
      <span className="text-[11px] font-medium text-muted-foreground/45">
        {label}
      </span>
      {count != null && count > 0
        ? (
            <span className="text-[10px] tabular-nums text-muted-foreground/30">
              {count}
            </span>
          )
        : null}
    </div>
  )
}
