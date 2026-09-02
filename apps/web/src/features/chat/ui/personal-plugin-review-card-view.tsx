import { SafeShieldLine as ShieldCheckIcon } from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/utils'

export interface PersonalPluginReviewItem {
  identity: string
  displayName: string
  permissions: Array<{ id: string, label: string }>
  layers: Array<{
    layer: 'server' | 'web' | 'desktop'
    status: string
  }>
}

export interface PersonalPluginReviewCardViewProps {
  title: string
  description: string
  actionLabel: string
  permissionFallback: string
  plugins: PersonalPluginReviewItem[]
  activating: boolean
  onActivate: () => void
}

function isSuccessfulStatus(status: string): boolean {
  return status === 'active' || status === 'discovered'
}

export function PersonalPluginReviewCardView({
  title,
  description,
  actionLabel,
  permissionFallback,
  plugins,
  activating,
  onActivate,
}: PersonalPluginReviewCardViewProps) {
  return (
    <div className="pointer-events-auto mb-2 border border-border/70 bg-background/95 px-3 py-2.5 shadow-sm">
      <div className="flex items-start gap-2.5">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={activating}
          onClick={onActivate}
          className="min-h-10 shrink-0 gap-1.5 transition-transform active:scale-[0.96]"
        >
          {activating && <Spinner className="size-3.5" />}
          {actionLabel}
        </Button>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {plugins.map(plugin => (
          <div key={plugin.identity} className="min-w-0 border-l-2 border-border pl-2">
            <p className="truncate text-[11.5px] font-medium text-foreground">{plugin.displayName}</p>
            <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1">
              {plugin.layers.map(layer => (
                <span key={layer.layer} className="inline-flex items-center gap-1 text-[10.5px] text-muted-foreground">
                  <span
                    className={cn('size-1.5 rounded-full bg-muted-foreground/40', {
                      'bg-success': isSuccessfulStatus(layer.status),
                      'bg-destructive': layer.status === 'failed' || layer.status === 'invalid',
                    })}
                  />
                  {`${layer.layer}: ${layer.status}`}
                </span>
              ))}
            </div>
            <p className="mt-1 break-words text-[10.5px] leading-4 text-muted-foreground">
              {plugin.permissions.length > 0
                ? plugin.permissions.map(permission => permission.label).join(', ')
                : permissionFallback}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
