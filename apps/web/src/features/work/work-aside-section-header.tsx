type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>

interface WorkAsideSectionHeaderProps {
  icon: IconType
  label: string
}

export function WorkAsideSectionHeader({
  icon: Icon,
  label,
}: WorkAsideSectionHeaderProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="text-[11px] font-semibold text-foreground/80">{label}</span>
    </div>
  )
}
