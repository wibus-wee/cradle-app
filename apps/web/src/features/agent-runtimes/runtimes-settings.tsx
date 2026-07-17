import { Refresh2Line as RefreshIcon, WarningLine as WarningIcon } from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '~/components/ui/empty'
import { AgentRuntimeConfigJsonSchema } from '~/features/agent-runtime/agent-config-schema'
import type { Agent } from '~/features/agent-runtime/use-agents'
import { useAgents } from '~/features/agent-runtime/use-agents'
import { useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'

import { SettingsMasterDetail } from '../settings/settings-container'
import { AcpRegistryDetail } from './acp-registry-detail'
import { BuiltinRuntimeDetail } from './builtin-runtime-detail'
import type { AcpListEntry, AcpListFilter, RuntimeSelection } from './runtime-list-pane'
import { RuntimeListPane } from './runtime-list-pane'
import { useAcpAgents, useAcpRegistry } from './use-acp-registry'

const drillTransition = { type: 'spring', stiffness: 600, damping: 40, mass: 0.8 } as const

function readAcpAgentId(agent: Agent): string | null {
  const result = AgentRuntimeConfigJsonSchema.safeParse(agent.configJson)
  return result.success ? (result.data.acpAgentId ?? null) : null
}

function selectionKey(selection: RuntimeSelection | null): string {
  if (!selection) {
    return 'none'
  }
  return selection.type === 'builtin' ? `builtin:${selection.runtimeKind}` : `acp:${selection.agentId}`
}

export function RuntimesSettings() {
  const { t } = useTranslation('runtimes')
  const catalogQuery = useRuntimeCatalog({ includeHidden: true })
  const registryQuery = useAcpRegistry()
  const installedQuery = useAcpAgents()
  const { agents } = useAgents()

  const [selection, setSelection] = useState<RuntimeSelection | null>(null)
  const [search, setSearch] = useState('')
  const [acpFilter, setAcpFilter] = useState<AcpListFilter>('all')

  const builtinRuntimes = useMemo(
    () => catalogQuery.runtimes.filter(runtime => runtime.source === 'builtin'),
    [catalogQuery.runtimes],
  )

  const acpEntries = useMemo<AcpListEntry[]>(() => {
    const installedById = new Map(installedQuery.installedAgents.map(agent => [agent.id, agent]))
    return registryQuery.registryAgents
      .map((agent) => {
        const installed = installedById.get(agent.id)
        return {
          agent,
          installed,
          updateAvailable: installed?.version != null && installed.version !== agent.version,
        }
      })
      .sort((left, right) => {
        const installedDelta = Number(right.installed != null) - Number(left.installed != null)
        return installedDelta !== 0 ? installedDelta : left.agent.name.localeCompare(right.agent.name)
      })
  }, [registryQuery.registryAgents, installedQuery.installedAgents])

  const selectedBuiltin = selection?.type === 'builtin'
    ? builtinRuntimes.find(runtime => runtime.runtimeKind === selection.runtimeKind)
    : undefined
  const selectedAcpEntry = selection?.type === 'acp'
    ? acpEntries.find(entry => entry.agent.id === selection.agentId)
    : undefined

  const acpUsedByAgents = useMemo(() => {
    if (selection?.type !== 'acp') {
      return []
    }
    return agents.filter(agent => agent.runtimeKind === 'acp-chat' && readAcpAgentId(agent) === selection.agentId)
  }, [agents, selection])

  const builtinUsedByAgents = useMemo(() => {
    if (!selectedBuiltin) {
      return []
    }
    return agents.filter(agent => agent.runtimeKind === selectedBuiltin.runtimeKind)
  }, [agents, selectedBuiltin])

  const isAcpLoading = registryQuery.isLoading
  const registryError = registryQuery.isError

  let detailContent: React.ReactNode
  if (selectedBuiltin) {
    detailContent = <BuiltinRuntimeDetail runtime={selectedBuiltin} usedByAgents={builtinUsedByAgents} />
  }
  else if (registryError) {
    detailContent = (
      <div className="flex flex-1 items-center justify-center p-6">
        <Empty className="border-none">
          <EmptyMedia variant="icon">
            <WarningIcon />
          </EmptyMedia>
          <EmptyTitle>{t('error.registry.title')}</EmptyTitle>
          <EmptyDescription>{t('error.registry.description')}</EmptyDescription>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void registryQuery.refetch()}
            data-testid="runtimes-registry-retry"
          >
            <RefreshIcon />
            {t('error.retry')}
          </Button>
        </Empty>
      </div>
    )
  }
  else if (selectedAcpEntry) {
    detailContent = (
      <AcpRegistryDetail
        agent={selectedAcpEntry.agent}
        installed={selectedAcpEntry.installed}
        usedByAgents={acpUsedByAgents}
      />
    )
  }
  else {
    detailContent = (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-[13px] text-text-tertiary select-none">{t('empty.noSelection')}</p>
      </div>
    )
  }

  return (
    <SettingsMasterDetail
      data-testid="runtimes-settings"
      title={t('page.title')}
      description={t('page.description')}
      list={(
        <RuntimeListPane
          builtinRuntimes={builtinRuntimes}
          acpEntries={acpEntries}
          isAcpLoading={isAcpLoading}
          selection={selection}
          onSelect={setSelection}
          search={search}
          onSearchChange={setSearch}
          acpFilter={acpFilter}
          onAcpFilterChange={setAcpFilter}
        />
      )}
      detail={(
        <AnimatePresence initial={false} mode="popLayout">
          <m.div
            key={selectionKey(selection)}
            className="flex min-h-full flex-1 flex-col"
            initial={{ opacity: 0, x: 20, filter: 'blur(4px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: -20, filter: 'blur(4px)' }}
            transition={drillTransition}
          >
            {detailContent}
          </m.div>
        </AnimatePresence>
      )}
    />
  )
}
