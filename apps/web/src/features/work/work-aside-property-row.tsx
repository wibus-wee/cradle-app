type IconType = React.ComponentType<React.SVGProps<SVGSVGElement>>

interface WorkAsidePropertyRowProps {
  icon: IconType
  label: string
  children: React.ReactNode
}

export function WorkAsidePropertyRow({
  icon: Icon,
  label,
  children,
}: WorkAsidePropertyRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <dt className="shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1.5 text-[11px] text-foreground/80">
        <Icon className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        {children}
      </dd>
    </div>
  )
}
