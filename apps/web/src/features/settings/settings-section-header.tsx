import { cn } from '~/lib/cn'

interface SettingsSectionHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function SettingsSectionHeader({ title, description, action, className }: SettingsSectionHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 pt-3', className)}>
      <div>
        <h3 className="text-base font-semibold text-foreground text-balance">{title}</h3>
        {description && (
          <p className="mt-1 text-[12px] text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}
