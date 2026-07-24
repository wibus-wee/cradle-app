import { useTranslation } from 'react-i18next'

import type { PostPluginsSourcesPreviewResponse } from '~/api-gen/types.gen'
import { Checkbox } from '~/components/ui/checkbox'

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
    <li className="flex items-start gap-2.5 rounded-md border border-border/50 px-3 py-2">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="mt-0.5"
        aria-label={plugin.displayName}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-foreground">
            {plugin.displayName}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            v
{plugin.version}
          </span>
        </div>
        {plugin.description && (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
            {plugin.description}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {plugin.trusted
            ? (
                <span className="text-[10.5px] text-muted-foreground">
                  {t('plugins.preview.trusted')}
                </span>
              )
            : (
                <span
                  className="text-[10.5px] text-amber-600 dark:text-amber-300"
                  title={plugin.trustReason ?? undefined}
                >
                  {t('plugins.preview.untrusted')}
                  {' · '}
                  {t('plugins.preview.untrustedHint')}
                </span>
              )}
          {plugin.declaredPermissions.length > 0 && (
            <span className="text-[10.5px] text-muted-foreground">
              {t('plugins.preview.permissions', { count: plugin.declaredPermissions.length })}
            </span>
          )}
        </div>
        {plugin.warnings.length > 0 && (
          <p className="mt-1 text-[10.5px] text-muted-foreground/80">
            {plugin.warnings.join(' · ')}
          </p>
        )}
      </div>
    </li>
  )
}
