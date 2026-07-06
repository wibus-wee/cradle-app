import { useEffect, useState } from 'react'

import { Kbd, KbdGroup } from '~/components/ui/kbd'
import { isUiRuntimeKindEnabled } from '~/features/agent-runtime/ui-availability'
import { cn } from '~/lib/cn'

import { AcpEventDetail } from './acp/acp-event-detail'
import { AcpEventsTable } from './acp/acp-events-table'
import { AcpFilterBar } from './acp/acp-filter-bar'
import { useAcpDevtoolStore } from './acp/use-acp-events'
import { useAcpKeyboard } from './acp/use-acp-keyboard'
import { HealthPanel } from './health/health-panel'
import { IpcEventDetail } from './ipc/ipc-event-detail'
import { IpcEventsTable } from './ipc/ipc-events-table'
import { IpcFilterBar } from './ipc/ipc-filter-bar'
import { useIpcDevtoolStore } from './ipc/use-ipc-events'
import { useIpcKeyboard } from './ipc/use-ipc-keyboard'
import { MemoryPanel } from './memory/memory-panel'
import { ObservabilityEventDetail } from './observability/observability-event-detail'
import { ObservabilityEventsTable } from './observability/observability-events-table'
import { useObservabilityDevtoolStore } from './observability/use-observability-events'
import { PluginsPanel } from './plugins/plugins-panel'
import { SurfacesPanel } from './surfaces/surfaces-panel'

type DevtoolTab = 'ipc' | 'acp' | 'observability' | 'health' | 'memory' | 'surfaces' | 'plugins'

const ACP_DEVTOOL_ENABLED = isUiRuntimeKindEnabled('acp-chat')

const ALL_DEVTOOL_TABS: { id: DevtoolTab, label: string, description: string }[] = [
  {
    id: 'ipc',
    label: 'IPC',
    description: 'IPC trace inspection — request/response lifecycle and payload',
  },
  {
    id: 'acp',
    label: 'ACP',
    description: 'ACP runtime output — agent process stdout/stderr and lifecycle',
  },
  {
    id: 'observability',
    label: 'Observability',
    description: 'Events, incidents, and payload inspection',
  },
  { id: 'health', label: 'Server Health', description: 'Server heartbeat and process memory' },
  { id: 'memory', label: 'Memory', description: 'Renderer heap and web vitals trend' },
  { id: 'surfaces', label: 'Surfaces', description: 'Router surface state and route ownership' },
  { id: 'plugins', label: 'Plugins', description: 'Plugin runtime graph and registrations' },
]

const DEVTOOL_TABS = ALL_DEVTOOL_TABS.filter(tab => ACP_DEVTOOL_ENABLED || tab.id !== 'acp')

function isDevtoolTabShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && !event.repeat
}

function getShortcutIndex(event: KeyboardEvent): number | null {
  if (!isDevtoolTabShortcut(event)) { return null }

  const keyMatch = event.key.match(/^[1-9]$/)
  if (keyMatch) { return Number(event.key) - 1 }

  const codeMatch = event.code.match(/^Digit([1-9])$/)
  if (codeMatch?.[1]) { return Number(codeMatch[1]) - 1 }

  return null
}

export function DevtoolPage() {
  const loadObservability = useObservabilityDevtoolStore(s => s.load)
  const initializeIpc = useIpcDevtoolStore(s => s.initialize)
  const initializeAcp = useAcpDevtoolStore(s => s.initialize)
  const [tab, setTab] = useState<DevtoolTab>('ipc')

  useEffect(() => {
    void loadObservability()
    void initializeIpc()
    if (ACP_DEVTOOL_ENABLED) {
      void initializeAcp()
    }
  }, [loadObservability, initializeIpc, initializeAcp])

  useIpcKeyboard(tab === 'ipc')
  useAcpKeyboard(ACP_DEVTOOL_ENABLED && tab === 'acp')

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const index = getShortcutIndex(event)
      if (index === null) { return }

      const nextTab = DEVTOOL_TABS[index]
      if (!nextTab) { return }

      event.preventDefault()
      setTab(nextTab.id)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const activeTab = DEVTOOL_TABS.find(t => t.id === tab) ?? DEVTOOL_TABS[0]

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground antialiased">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-medium text-foreground">/devtool</span>
            <span className="rounded-sm bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-500">
              live
            </span>
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {activeTab.description}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {DEVTOOL_TABS.map((t, index) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-2.5 font-mono text-[11px] transition-[background-color,border-color,color,transform]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.96]',
                tab === t.id
                  ? 'border-border bg-muted text-foreground shadow-sm'
                  : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground',
              )}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <span>{t.label}</span>
              <Kbd className="h-4 min-w-4 rounded-[3px] px-1 font-mono text-[9px]">{index + 1}</Kbd>
            </button>
          ))}
        </div>

        <KbdGroup className="hidden shrink-0 font-mono text-[10px] text-muted-foreground md:inline-flex">
          <Kbd>Cmd</Kbd>
          <Kbd>{`1-${DEVTOOL_TABS.length}`}</Kbd>
          <span>or</span>
          <Kbd>Ctrl</Kbd>
          <Kbd>{`1-${DEVTOOL_TABS.length}`}</Kbd>
        </KbdGroup>
      </div>

      {tab === 'ipc' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <IpcFilterBar />
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-3 overflow-hidden border-r border-border">
              <IpcEventsTable />
            </div>
            <div className="flex-2 overflow-hidden">
              <IpcEventDetail />
            </div>
          </div>
        </div>
      )}

      {ACP_DEVTOOL_ENABLED && tab === 'acp' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <AcpFilterBar />
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-3 overflow-hidden border-r border-border">
              <AcpEventsTable />
            </div>
            <div className="flex-2 overflow-hidden">
              <AcpEventDetail />
            </div>
          </div>
        </div>
      )}

      {tab === 'observability' && (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-3 overflow-hidden border-r border-border">
            <ObservabilityEventsTable />
          </div>
          <div className="flex-2 overflow-hidden">
            <ObservabilityEventDetail />
          </div>
        </div>
      )}

      {tab === 'health' && (
        <div className="flex-1 overflow-hidden">
          <HealthPanel />
        </div>
      )}

      {tab === 'memory' && (
        <div className="flex-1 overflow-hidden">
          <MemoryPanel />
        </div>
      )}

      {tab === 'surfaces' && (
        <div className="flex-1 overflow-hidden">
          <SurfacesPanel />
        </div>
      )}

      {tab === 'plugins' && (
        <div className="flex-1 overflow-hidden">
          <PluginsPanel />
        </div>
      )}
    </div>
  )
}
