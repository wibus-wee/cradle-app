import { SettingsDivider } from './settings-row'

interface DesktopOperationsCardProps {
  title: string
  badge: React.ReactNode
  children: React.ReactNode
  testId?: string
}

export function DesktopOperationsCard({
  title,
  badge,
  children,
  testId,
}: DesktopOperationsCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card/40" data-testid={testId}>
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <span className="text-[12px] font-medium text-foreground">{title}</span>
        {badge}
      </div>
      <SettingsDivider />
      <div className="flex flex-col gap-3 px-4 py-3">{children}</div>
    </div>
  )
}
