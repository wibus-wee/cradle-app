import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'
import { usePluginStore } from '~/lib/plugin-store'

import { PluginGraph } from './plugin-graph'
import type { PluginInfo } from './use-plugin-data'
import { usePluginData } from './use-plugin-data'

function formatTimeSince(ts: number | undefined): string {
  if (!ts) { return '—' }
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) { return `${diff}s ago` }
  if (diff < 3600) { return `${Math.floor(diff / 60)}m ago` }
  return `${Math.floor(diff / 3600)}h ago`
}

function getPluginOwner(plugin: PluginInfo): string {
  return plugin.identity ?? plugin.name
}

function getLayerStatus(plugin: PluginInfo, layer: 'server' | 'web' | 'desktop'): string {
  const hasLayer
    = layer === 'server' ? plugin.hasServer : layer === 'web' ? plugin.hasWeb : plugin.hasDesktop

  return plugin.layers?.[layer]?.status ?? (hasLayer ? 'discovered' : 'skipped')
}

export function PluginsPanel() {
  const { t } = useTranslation('devtool')
  const { plugins, loading, error, refresh, getActivatedAt } = usePluginData()
  const panels = usePluginStore(s => s.panels)
  const commands = usePluginStore(s => s.commands)
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null)

  const serverCount = plugins.filter(p => p.hasServer).length
  const webCount = plugins.filter(p => p.hasWeb).length
  const desktopCount = plugins.filter(p => p.hasDesktop).length

  return (
    <div className="h-full overflow-auto p-4 font-mono text-[11px]">
      {/* Stats bar */}
      {!loading && !error && (
        <div className="mb-3 flex items-center gap-2 text-muted-foreground">
          <span>{t('plugins.stats.plugins', { count: plugins.length })}</span>
          <span>|</span>
          <span>{t('plugins.stats.server', { count: serverCount })}</span>
          <span>|</span>
          <span>{t('plugins.stats.web', { count: webCount })}</span>
          <span>|</span>
          <span>{t('plugins.stats.desktop', { count: desktopCount })}</span>
          <span>|</span>
          <span>{t('plugins.stats.panel', { count: panels.length })}</span>
          <span>|</span>
          <span>{t('plugins.stats.command', { count: commands.length })}</span>
        </div>
      )}

      {/* Topology Graph */}
      {!loading && !error && plugins.length > 0 && (
        <PluginGraph plugins={plugins} panels={panels} commands={commands} />
      )}

      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-foreground font-medium">{t('plugins.title')}</span>
        <span className="text-muted-foreground">
(
{plugins.length}
)
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto rounded border border-border px-2 py-0.5 text-muted-foreground hover:bg-fill hover:text-foreground"
        >
          {t('plugins.refresh')}
        </button>
      </div>

      {/* Loading / Error */}
      {loading && <div className="text-muted-foreground">{t('plugins.loading')}</div>}
      {error && <div className="text-red-400">{t('plugins.error', { message: error })}</div>}

      {/* Plugin list */}
      {!loading && !error && (
        <div className="space-y-2">
          {plugins.map(p => (
            <PluginListItem
              key={getPluginOwner(p)}
              plugin={p}
              expanded={expandedPlugin === getPluginOwner(p)}
              onToggle={() => {
                const owner = getPluginOwner(p)
                setExpandedPlugin(expandedPlugin === owner ? null : owner)
              }}
              activatedAt={getActivatedAt(p)}
              panels={panels.filter(panel => panel.owner === getPluginOwner(p))}
              commands={commands.filter(command => command.owner === getPluginOwner(p))}
            />
          ))}
          {plugins.length === 0 && (
            <div className="text-muted-foreground">{t('plugins.empty')}</div>
          )}
        </div>
      )}

      {/* Client-side registrations */}
      <div className="mt-6 border-t border-border pt-4">
        <div className="mb-2 text-foreground font-medium">{t('plugins.clientRegistrations')}</div>

        {/* Panels */}
        <div className="mb-3">
          <div className="mb-1 text-muted-foreground">{t('plugins.panels', { count: panels.length })}</div>
          {panels.length === 0 && <div className="text-muted-foreground/60">{t('plugins.none')}</div>}
          {panels.map(panel => (
            <div key={panel.id} className="flex items-center gap-2 py-0.5">
              <span className="text-foreground">{panel.title}</span>
              <span className="text-muted-foreground">{panel.localId}</span>
              <span className="rounded bg-fill px-1 text-muted-foreground">{panel.owner}</span>
              {panel.location && (
                <span className="rounded bg-fill px-1 text-muted-foreground">{panel.location}</span>
              )}
            </div>
          ))}
        </div>

        {/* Commands */}
        <div>
          <div className="mb-1 text-muted-foreground">{t('plugins.commands', { count: commands.length })}</div>
          {commands.length === 0 && <div className="text-muted-foreground/60">{t('plugins.none')}</div>}
          {commands.map(cmd => (
            <div key={cmd.id} className="flex items-center gap-2 py-0.5">
              <button
                type="button"
                onClick={() => void cmd.execute()}
                className="rounded border border-border px-1 py-0.5 text-muted-foreground hover:bg-fill hover:text-foreground"
                aria-label={t('plugins.executeAria', { title: cmd.title })}
                title={t('plugins.executeTitle')}
              >
                <span aria-hidden="true">▶</span>
              </button>
              <span className="text-foreground">{cmd.title}</span>
              <span className="text-muted-foreground">{cmd.localId}</span>
              <span className="rounded bg-fill px-1 text-muted-foreground">{cmd.owner}</span>
              {cmd.keybinding && (
                <span className="rounded bg-fill px-1 text-muted-foreground">{cmd.keybinding}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PluginListItem({
  plugin,
  expanded,
  onToggle,
  activatedAt,
  panels,
  commands,
}: {
  plugin: PluginInfo
  expanded: boolean
  onToggle: () => void
  activatedAt: number | undefined
  panels: Array<{ id: string, localId: string, title: string, owner: string }>
  commands: Array<{
    id: string
    localId: string
    title: string
    owner: string
    execute: () => void | Promise<void>
  }>
}) {
  const owner = getPluginOwner(plugin)
  const webStatus = getLayerStatus(plugin, 'web')
  const isActive = webStatus === 'active' || panels.length > 0 || commands.length > 0

  return (
    <div className="rounded border border-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-fill"
      >
        {/* Status dot */}
        <span
          className={cn(
            'inline-block size-1.5 shrink-0 rounded-full',
            isActive ? 'bg-emerald-400' : 'bg-muted-foreground/30',
          )}
        />
        <span className="text-foreground">{plugin.displayName || plugin.name}</span>
        <span className="text-muted-foreground">{plugin.version}</span>
        {plugin.routeSegment && (
          <span className="text-muted-foreground">{plugin.routeSegment}</span>
        )}
        <div className="ml-auto flex gap-1">
          {plugin.hasServer && (
            <PlatformBadge label={getLayerStatus(plugin, 'server')} variant="blue" />
          )}
          {plugin.hasWeb && (
            <PlatformBadge label={getLayerStatus(plugin, 'web')} variant="purple" />
          )}
          {plugin.hasDesktop && (
            <PlatformBadge label={getLayerStatus(plugin, 'desktop')} variant="amber" />
          )}
        </div>
        <span className="text-muted-foreground">{expanded ? '▾' : '▸'}</span>
      </button>

      {plugin.description && !expanded && (
        <div className="px-2 pb-2 text-muted-foreground">{plugin.description}</div>
      )}

      {expanded && (
        <div className="border-t border-border p-2 space-y-2">
          {plugin.description && <div className="text-muted-foreground">{plugin.description}</div>}

          <div className="space-y-0.5">
            <div className="text-muted-foreground font-medium">Descriptor</div>
            <InfoRow label="identity" value={owner} />
            <InfoRow label="route" value={plugin.routeSegment ?? 'legacy'} />
            {plugin.source && (
              <>
                <InfoRow label="source" value={plugin.source.kind} />
                <InfoRow label="trusted" value={String(plugin.source.trusted)} />
                <InfoRow label="path" value={plugin.source.packageDir} />
                {plugin.source.provenance && (
                  <>
                    <InfoRow label="origin" value={plugin.source.provenance.kind} />
                    <InfoRow label="origin mode" value={plugin.source.provenance.mode} />
                    <InfoRow label="origin repo" value={plugin.source.provenance.repository} />
                    <InfoRow label="origin path" value={plugin.source.provenance.path} />
                    <InfoRow label="origin ref" value={plugin.source.provenance.ref} />
                  </>
                )}
              </>
            )}
          </div>

          {/* Entry points */}
          <div className="space-y-0.5">
            <div className="text-muted-foreground font-medium">Entry Points</div>
            {plugin.hasServer && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">server:</span>
                <span className="text-foreground">{plugin.serverEntry || '—'}</span>
              </div>
            )}
            {plugin.hasWeb && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">web:</span>
                <span className="text-foreground">{plugin.webEntry || '—'}</span>
              </div>
            )}
            {plugin.hasDesktop && (
              <div className="flex gap-2">
                <span className="text-muted-foreground">desktop:</span>
                <span className="text-foreground">{plugin.desktopEntry || '—'}</span>
              </div>
            )}
          </div>

          {/* Activation time */}
          <div className="flex gap-2">
            <span className="text-muted-foreground">Activated:</span>
            <span className="text-foreground">{formatTimeSince(activatedAt)}</span>
          </div>

          {plugin.layers && (
            <div className="space-y-0.5">
              <div className="text-muted-foreground font-medium">Layers</div>
              {(['server', 'web', 'desktop'] as const).map(layer => (
                <InfoRow
                  key={layer}
                  label={layer}
                  value={`${plugin.layers?.[layer]?.status ?? 'skipped'}${plugin.layers?.[layer]?.error ? `: ${plugin.layers[layer]?.error}` : ''}`}
                />
              ))}
            </div>
          )}

          {plugin.capabilities && plugin.capabilities.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-muted-foreground font-medium">Capabilities</div>
              {plugin.capabilities.map(capability => (
                <div key={capability.id} className="flex items-center gap-2">
                  <span className="text-foreground">{capability.label ?? capability.type}</span>
                  <span className="text-muted-foreground">{capability.id}</span>
                  <span className="rounded bg-fill px-1 text-muted-foreground">
                    {capability.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {plugin.declaredCapabilities && plugin.declaredCapabilities.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-muted-foreground font-medium">Declared Capabilities</div>
              {plugin.declaredCapabilities.map(capability => (
                <div key={capability.id} className="flex items-center gap-2">
                  <span className="text-foreground">{capability.label ?? capability.type}</span>
                  <span className="text-muted-foreground">{capability.localId}</span>
                  <span className="rounded bg-fill px-1 text-muted-foreground">
                    {capability.layer ?? 'any'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {plugin.declaredPermissions && plugin.declaredPermissions.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-muted-foreground font-medium">Declared Permissions</div>
              {plugin.declaredPermissions.map(permission => (
                <div key={permission.id} className="flex items-center gap-2">
                  <span className="text-foreground">{permission.label ?? permission.localId}</span>
                  <span className="text-muted-foreground">{permission.localId}</span>
                  {permission.required === true && (
                    <span className="rounded bg-fill px-1 text-muted-foreground">required</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {plugin.warnings && plugin.warnings.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-muted-foreground font-medium">Warnings</div>
              {plugin.warnings.map(warning => (
                <div key={warning} className="text-amber-400">
                  {warning}
                </div>
              ))}
            </div>
          )}

          {/* Commands belonging to this plugin */}
          {(panels.length > 0 || commands.length > 0) && plugin.hasWeb && (
            <div className="space-y-0.5">
              <div className="text-muted-foreground font-medium">Web Contributions</div>
              {panels.map(panel => (
                <div key={panel.id} className="flex items-center gap-2">
                  <span className="text-foreground">{panel.title}</span>
                  <span className="text-muted-foreground">{panel.localId}</span>
                  <span className="rounded bg-fill px-1 text-muted-foreground">panel</span>
                </div>
              ))}
              {commands.map(cmd => (
                <div key={cmd.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void cmd.execute()}
                    className="rounded border border-border px-1 py-0.5 text-muted-foreground hover:bg-fill hover:text-foreground"
                    aria-label={`Execute ${cmd.title}`}
                    title="Execute command"
                  >
                    <span aria-hidden="true">▶</span>
                  </button>
                  <span className="text-foreground">{cmd.title}</span>
                  <span className="text-muted-foreground">{cmd.localId}</span>
                  <span className="rounded bg-fill px-1 text-muted-foreground">command</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground">
{label}
:
      </span>
      <span className="text-foreground break-all">{value}</span>
    </div>
  )
}

function PlatformBadge({
  label,
  variant,
}: {
  label: string
  variant: 'blue' | 'purple' | 'amber'
}) {
  return (
    <span
      className={cn('rounded px-1.5 py-0.5 text-[10px]', {
        'bg-blue-500/15 text-blue-400': variant === 'blue',
        'bg-purple-500/15 text-purple-400': variant === 'purple',
        'bg-amber-500/15 text-amber-400': variant === 'amber',
      })}
    >
      {label}
    </span>
  )
}
