import { GithubLine as GithubIcon, Link3Line as LinkIcon, PackageLine as NpmIcon } from '@mingcute/react'

import { cn } from '~/lib/cn'

interface PluginSourceExampleChipProps {
  label: string
  value: string
  onPick: (value: string) => void
}

export function PluginSourceExampleChip({
  label,
  value,
  onPick,
}: PluginSourceExampleChipProps) {
  const Icon = value.startsWith('cradle://')
    ? LinkIcon
    : value.startsWith('http') || value.includes('/')
      ? GithubIcon
      : NpmIcon

  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      title={value}
      className={cn(
        'flex min-h-9 items-center gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-1.5',
        'text-[12px] text-muted-foreground transition-colors duration-150',
        'hover:border-border hover:bg-muted/40 hover:text-foreground active:scale-[0.96]',
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground/80" aria-hidden="true" />
      <span className="font-medium text-foreground/80">{label}</span>
    </button>
  )
}
