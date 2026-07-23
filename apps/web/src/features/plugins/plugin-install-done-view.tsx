import { useTranslation } from 'react-i18next'

import type { PostPluginsSourcesResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

import { InstalledPluginRowView } from './installed-plugin-row-view'

type InstalledPlugin = PostPluginsSourcesResponse['discoveredPlugins'][number]

interface PluginInstallDoneViewProps {
  result: PostPluginsSourcesResponse
  serverUrl: string
  enablingRouteSegment: string | null
  undoing: boolean
  onEnable: (plugin: InstalledPlugin) => void
  onUndo: () => void
  onDone?: () => void
}

export function PluginInstallDoneView({
  result,
  serverUrl,
  enablingRouteSegment,
  undoing,
  onEnable,
  onUndo,
  onDone,
}: PluginInstallDoneViewProps) {
  const { t } = useTranslation('settings')
  const plugins = result.discoveredPlugins

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h4 className="text-[13px] font-medium text-foreground">
          {t('plugins.add.resultTitle')}
        </h4>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {t('plugins.add.resultHint')}
        </p>
      </div>

      {plugins.length === 0
        ? (
            <p className="rounded-md bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
              {t('plugins.add.resultEmpty')}
            </p>
          )
        : (
            <ul className="flex flex-col gap-2">
              {plugins.map(plugin => (
                <InstalledPluginRowView
                  key={plugin.routeSegment}
                  plugin={plugin}
                  serverUrl={serverUrl}
                  enabling={enablingRouteSegment === plugin.routeSegment}
                  onEnable={() => onEnable(plugin)}
                />
              ))}
            </ul>
          )}

      <div className="flex justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onUndo}
          disabled={undoing}
          className="gap-1.5"
        >
          {undoing && <Spinner className="size-3.5" />}
          {t('plugins.add.undo')}
        </Button>
        <Button size="sm" onClick={onDone}>
          {t('plugins.add.done')}
        </Button>
      </div>
    </div>
  )
}
