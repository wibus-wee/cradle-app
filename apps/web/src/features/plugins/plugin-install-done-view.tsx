import { CheckLine as CheckIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import type { PostPluginsSourcesResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

import { InstalledPluginRowView } from './installed-plugin-row-view'
import { PluginInstallStepHeader } from './plugin-install-step-header'

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
    <div className="flex flex-col gap-4">
      <PluginInstallStepHeader current="done" />

      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 animate-in zoom-in-50 fade-in duration-300"
        >
          <CheckIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h4 className="text-[15px] leading-6 font-semibold text-foreground text-balance">
            {t('plugins.add.resultTitle')}
          </h4>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            {t('plugins.add.resultHint')}
          </p>
        </div>
      </div>

      {plugins.length === 0
        ? (
            <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-[12.5px] text-muted-foreground">
              {t('plugins.add.resultEmpty')}
            </p>
          )
        : (
            <ul className="flex flex-col gap-2">
              {plugins.map((plugin, index) => (
                <div
                  key={plugin.routeSegment}
                  className="animate-in fade-in slide-in-from-bottom-1 duration-200"
                  style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'backwards' }}
                >
                  <InstalledPluginRowView
                    plugin={plugin}
                    serverUrl={serverUrl}
                    enabling={enablingRouteSegment === plugin.routeSegment}
                    onEnable={() => onEnable(plugin)}
                  />
                </div>
              ))}
            </ul>
          )}

      <div className="flex justify-between gap-2 pt-1">
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
        <Button onClick={onDone} className="h-9 px-4 text-[13px]">
          {t('plugins.add.done')}
        </Button>
      </div>
    </div>
  )
}
