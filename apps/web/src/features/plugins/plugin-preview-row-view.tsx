import { ShieldLine as ShieldIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import type { PostPluginsSourcesPreviewResponse } from '~/api-gen/types.gen'
import { Checkbox } from '~/components/ui/checkbox'
import { cn } from '~/lib/cn'

import { PluginAvatar } from './plugin-avatar'

type PreviewPlugin = PostPluginsSourcesPreviewResponse['plugins'][number]

interface PluginPreviewRowViewProps {
  plugin: PreviewPlugin
  checked: boolean
  onToggle: () => void
}

export function PluginPreviewRowView({
  plugin,
  checked,
  onToggle,
}: PluginPreviewRowViewProps) {
  const { t } = useTranslation('settings')

  return (
    <li>
      <label
        className={cn(
          'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3',
          'transition-[background-color,border-color] duration-150',
          checked
            ? 'border-primary/60 bg-primary/[0.05]'
            : 'border-border/60 hover:border-border hover:bg-muted/30',
        )}
      >
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          className="mt-1"
          aria-label={plugin.displayName}
        />
        <PluginAvatar iconUrl={null} name={plugin.displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-[13px] font-medium text-foreground">
              {plugin.displayName}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
              v
              {plugin.version}
            </span>
          </div>
          {plugin.description && (
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground text-pretty">
              {plugin.description}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {plugin.trusted
              ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                    <ShieldIcon className="size-3" aria-hidden="true" />
                    {t('plugins.preview.trusted')}
                  </span>
                )
              : (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300"
                    title={plugin.trustReason ?? undefined}
                  >
                    <ShieldIcon className="size-3" aria-hidden="true" />
                    {t('plugins.preview.untrusted')}
                    {' · '}
                    {t('plugins.preview.untrustedHint')}
                  </span>
                )}
            {plugin.declaredPermissions.length > 0 && (
              <span className="rounded-md bg-fill px-1.5 py-px text-[10.5px] text-muted-foreground tabular-nums">
                {t('plugins.preview.permissions', { count: plugin.declaredPermissions.length })}
              </span>
            )}
          </div>
          {plugin.warnings.length > 0 && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-amber-600/90 dark:text-amber-300/90">
              {plugin.warnings.join(' · ')}
            </p>
          )}
        </div>
      </label>
    </li>
  )
}
