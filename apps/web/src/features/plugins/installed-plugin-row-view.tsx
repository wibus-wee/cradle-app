import { CheckLine as CheckIcon } from '@mingcute/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { PostPluginsSourcesResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

import { PluginAvatar } from './plugin-avatar'

type InstalledPlugin = PostPluginsSourcesResponse['discoveredPlugins'][number]

interface InstalledPluginRowViewProps {
  plugin: InstalledPlugin
  serverUrl: string
  enabling: boolean
  onEnable: () => void
}

function resolveIconUrl(iconUrl: string | null, serverUrl: string): string | null {
  if (!iconUrl) {
    return null
  }
  try {
    return new URL(iconUrl, serverUrl).toString()
  }
  catch {
    return iconUrl
  }
}

export function InstalledPluginRowView({
  plugin,
  serverUrl,
  enabling,
  onEnable,
}: InstalledPluginRowViewProps) {
  const { t } = useTranslation('settings')
  const iconUrl = useMemo(
    () => resolveIconUrl(plugin.iconUrl, serverUrl),
    [plugin.iconUrl, serverUrl],
  )
  const enabled = plugin.activation.enabled
  const untrustedExternal = plugin.source.kind === 'externalLocal' && !plugin.source.trusted

  return (
    <li className="flex items-center gap-2.5 rounded-md border border-border/50 px-3 py-2">
      <PluginAvatar iconUrl={iconUrl} name={plugin.displayName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-foreground">
            {plugin.displayName}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            v
{plugin.version}
          </span>
        </div>
        {untrustedExternal && !enabled && (
          <p className="mt-0.5 text-[10.5px] text-amber-600 dark:text-amber-300">
            {t('plugins.needsTrust')}
          </p>
        )}
      </div>
      {enabled
        ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <CheckIcon className="size-3.5" aria-hidden="true" />
              {t('plugins.preview.trusted')}
            </span>
          )
        : (
            <Button
              size="sm"
              variant="outline"
              onClick={onEnable}
              disabled={enabling}
              className="h-7 gap-1.5"
            >
              {enabling && <Spinner className="size-3" />}
              {t('plugins.marketplace.enable')}
            </Button>
          )}
    </li>
  )
}
