import { cn } from '~/lib/cn'

export function StatusDot({ tone }: { tone: 'active' | 'muted' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-2 shrink-0 rounded-full',
        tone === 'active' ? 'bg-emerald-500' : 'bg-muted-foreground/45',
      )}
    />
  )
}
