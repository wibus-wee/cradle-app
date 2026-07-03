import {
  CheckboxLine as SquareCheckIcon,
  CloseLine as XIcon,
  DeleteLine as Trash2Icon,
  DownloadLine as DownloadIcon,
  PlusLine as PlusIcon,
  RightSmallLine as ChevronRightIcon,
  RobotLine as BotIcon,
  SearchLine as SearchIcon,
  SelectorHorizontalLine as SlidersHorizontalIcon,
  SquareLine as SquareIcon,
} from '@mingcute/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ProviderIcon } from '~/components/common/provider-icons'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Input } from '~/components/ui/input'
import { ScrollArea } from '~/components/ui/scroll-area'
import { AgentRuntimeConfigJsonSchema } from '~/features/agent-runtime/agent-config-schema'
import { buildAvatarUrl } from '~/features/agent-runtime/avatar-url'
import { runtimeSupportsProviderKind } from '~/features/agent-runtime/runtime-compatibility'
import type { ModelDescriptor, ProviderTarget } from '~/features/agent-runtime/types'
import { useProviderTargetModelMap } from '~/features/agent-runtime/use-agent-models'
import type { Agent, PreviewLocalConfigImportResult } from '~/features/agent-runtime/use-agents'
import { useAgents } from '~/features/agent-runtime/use-agents'
import type { ProviderTargetOption } from '~/features/agent-runtime/use-provider-targets'
import { useProviderTargets } from '~/features/agent-runtime/use-provider-targets'
import type { RuntimeCatalogItem } from '~/features/agent-runtime/use-runtime-catalog'
import {
  runtimeCatalogItemUsesCliLaunchConfig,
  runtimeCatalogItemUsesModelSelection,
  useRuntimeCatalog,
} from '~/features/agent-runtime/use-runtime-catalog'
import {
  filterThinkingOptionsForModel,
  selectSupportedThinkingValue,
} from '~/features/composer-toolbar/constants'
import type { ThinkingOption } from '~/features/composer-toolbar/provider-model-menu'
import { ProviderModelPicker } from '~/features/composer-toolbar/provider-model-picker'
import { cn } from '~/lib/cn'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import { SettingsMasterDetail } from '../settings/settings-container'
import type { AgentBatchThinkingEffort, AgentProviderBatchSelection } from './agent-batch-configuration'
import {
  buildAgentProviderBatchPatches,
} from './agent-batch-configuration'
import { AgentDetailPage } from './agent-detail'
import { StatusDot } from './agent-status-dot'
import { CreateAgentDialog } from './create-agent-dialog'
import {
  applyVisibleRangeSelection,
  mergeVisibleSelection,
  pruneSelectedIds,
  removeVisibleSelection,
  selectedIdFromSet,
  selectedRecords,
  visibleRecordsAreSelected,
} from './settings-multi-selection'
import { useSettingsSelectionShortcuts } from './settings-selection-shortcuts'

const AGENT_THINKING_EFFORTS: Array<{ value: AgentBatchThinkingEffort }> = [
  { value: 'low' },
  { value: 'medium' },
  { value: 'high' },
  { value: 'xhigh' },
]

type AgentManagementKey = keyof typeof import('~/locales/default').default.agentManagement

const thinkingLabelKeys = {
  low: 'detail.thinking.low.label',
  medium: 'detail.thinking.medium.label',
  high: 'detail.thinking.high.label',
  xhigh: 'detail.thinking.xhigh.label',
} satisfies Record<AgentBatchThinkingEffort, AgentManagementKey>

const thinkingDescriptionKeys = {
  low: 'detail.thinking.low.description',
  medium: 'detail.thinking.medium.description',
  high: 'detail.thinking.high.description',
  xhigh: 'detail.thinking.xhigh.description',
} satisfies Record<AgentBatchThinkingEffort, AgentManagementKey>

function commonString(values: Array<string | null>): string | null {
  if (values.length === 0) {
    return null
  }
  const first = values[0] ?? null
  return values.every(value => value === first) ? first : null
}

function providerTargetFromOption(option: ProviderTargetOption): ProviderTarget {
  return { kind: option.kind, id: option.id }
}

function agentUsesProviderTarget(agent: Agent, runtimeCatalog: RuntimeCatalogItem[]): boolean {
  const runtime = runtimeCatalog.find(item => item.runtimeKind === agent.runtimeKind)
  return runtime ? runtimeCatalogItemUsesModelSelection(runtime) : true
}

function providerTargetCompatibleWithAgents(
  target: ProviderTargetOption,
  agents: Agent[],
  runtimeCatalog: RuntimeCatalogItem[],
): boolean {
  return agents.every(agent =>
    !agentUsesProviderTarget(agent, runtimeCatalog)
    || runtimeSupportsProviderKind(agent.runtimeKind, target.providerKind, runtimeCatalog))
}

function defaultBatchProviderTarget(
  agents: Agent[],
  providerTargets: ProviderTargetOption[],
  runtimeCatalog: RuntimeCatalogItem[],
): ProviderTarget | null {
  const providerAgents = agents.filter(agent => agentUsesProviderTarget(agent, runtimeCatalog))
  const enabledTargets = providerTargets.filter(target =>
    target.enabled && providerTargetCompatibleWithAgents(target, providerAgents, runtimeCatalog))
  const commonTargetId = commonString(providerAgents.map(agent => agent.providerTargetId))
  const commonTarget = commonTargetId
    ? enabledTargets.find(target => target.id === commonTargetId) ?? null
    : null
  if (commonTarget) {
    return providerTargetFromOption(commonTarget)
  }
  const fallbackTarget = enabledTargets[0] ?? null
  return fallbackTarget ? providerTargetFromOption(fallbackTarget) : null
}

function defaultBatchModelId(
  agents: Agent[],
  providerTarget: ProviderTarget | null,
  runtimeCatalog: RuntimeCatalogItem[],
): string | null {
  if (!providerTarget) {
    return null
  }
  const matchingAgents = agents.filter(
    agent =>
      agentUsesProviderTarget(agent, runtimeCatalog)
      && agent.providerTargetId === providerTarget.id,
  )
  return commonString(matchingAgents.map(agent => agent.modelId))
}

function readAgentBatchThinkingEffort(value: unknown): AgentBatchThinkingEffort {
  switch (value) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value
    case 'max':
      return 'xhigh'
    case 'none':
    case 'minimal':
      return 'low'
    default:
      return 'high'
  }
}

function defaultBatchThinkingEffort(
  agents: Agent[],
  runtimeCatalog: RuntimeCatalogItem[],
): AgentBatchThinkingEffort {
  const providerAgents = agents.filter(agent => agentUsesProviderTarget(agent, runtimeCatalog))
  if (providerAgents.length === 0) {
    return 'high'
  }
  const first = readAgentBatchThinkingEffort(providerAgents[0]?.thinkingEffort)
  return providerAgents.every(agent => readAgentBatchThinkingEffort(agent.thinkingEffort) === first) ? first : 'high'
}

function AgentSidebarRow({
  agent,
  providerTargets,
  runtimeCatalog,
  active,
  selected,
  onClick,
  onToggleSelected,
}: {
  agent: Agent
  providerTargets: ProviderTargetOption[]
  runtimeCatalog: RuntimeCatalogItem[]
  active: boolean
  selected: boolean
  onClick: (shiftKey: boolean) => void
  onToggleSelected: (checked: boolean, shiftKey: boolean) => void
}) {
  const checkboxShiftKeyRef = useRef(false)
  const avatarUrl = agent.avatarUrl || buildAvatarUrl(agent.avatarStyle, agent.avatarSeed)
  const lobeIconSlug = agent.avatarStyle === 'lobehub-icon' ? agent.avatarSeed : null
  const providerTarget = agent.providerTargetId
    ? providerTargets.find(target => target.id === agent.providerTargetId) ?? null
    : null
  const runtime = runtimeCatalog.find(item => item.runtimeKind === agent.runtimeKind)
  const runtimeConfig = AgentRuntimeConfigJsonSchema.parse(agent.configJson)
  const usesCliLaunchConfig = runtime
    ? runtimeCatalogItemUsesCliLaunchConfig(runtime)
    : runtimeConfig.cliTui !== null
  const cliTuiLaunch
    = usesCliLaunchConfig
      ? runtimeConfig.cliTui
      : null
  const subtitle
    = usesCliLaunchConfig
      ? [runtime?.label ?? agent.runtimeKind, cliTuiLaunch?.preset ?? cliTuiLaunch?.executable]
          .filter(Boolean)
          .join(' ·\n') || runtime?.label || agent.runtimeKind
      : [providerTarget?.name, agent.modelId].filter(Boolean).join(' ·\n') || undefined

  return (
    <div
      data-testid={`agent-sidebar-row-${agent.id}`}
      className={cn(
        'group/sidebar-row flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none',
        'transition-[background-color,opacity,scale] duration-150',
        // 'focus-within:ring-2 focus-within:ring-ring/50',
        active
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-foreground/[0.035] active:bg-foreground/6',
        !agent.enabled && !active && 'opacity-60',
      )}
    >
      <Checkbox
        checked={selected}
        onClickCapture={(event) => {
          checkboxShiftKeyRef.current = event.shiftKey
        }}
        onCheckedChange={(value) => {
          onToggleSelected(!!value, checkboxShiftKeyRef.current)
          checkboxShiftKeyRef.current = false
        }}
      />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
        onClick={event => onClick(event.shiftKey)}
      >
        <div className="size-7 shrink-0 overflow-hidden rounded-lg bg-foreground/5">
          {lobeIconSlug
            ? <ProviderIcon iconSlug={lobeIconSlug} presetId={null} className="size-full p-1" />
            : avatarUrl && (
                <img
                  src={avatarUrl}
                  alt={agent.name}
                  className="size-full object-cover"
                  crossOrigin="anonymous"
                />
              )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'block truncate text-[12.5px] leading-tight',
                active ? 'font-medium text-foreground' : 'text-foreground/90',
              )}
            >
              {agent.name}
            </span>
            <StatusDot tone={agent.enabled ? 'active' : 'muted'} />
          </div>
          {subtitle && (
            <span className="block truncate whitespace-pre text-[10.5px] leading-tight text-muted-foreground/70">
              {subtitle}
            </span>
          )}
        </div>
        <ChevronRightIcon
          className={cn(
            'size-3 shrink-0 !text-muted-foreground/40 transition-[opacity,transform] duration-150',
            active
              ? 'opacity-100 translate-x-0'
              : 'opacity-0 -translate-x-1 group-hover/sidebar-row:opacity-60 group-hover/sidebar-row:translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

function AgentBatchProviderPanel({
  selectedAgents,
  providerTargets,
  runtimeCatalog,
  busy,
  onApply,
  onClear,
}: {
  selectedAgents: Agent[]
  providerTargets: ProviderTargetOption[]
  runtimeCatalog: RuntimeCatalogItem[]
  busy: boolean
  onApply: (selection: AgentProviderBatchSelection) => void
  onClear: () => void
}) {
  const { t } = useTranslation('agentManagement')
  const providerAgents = selectedAgents.filter(agent => agentUsesProviderTarget(agent, runtimeCatalog))
  const skippedRuntimeOwnedCount = selectedAgents.length - providerAgents.length
  const selectableProviderTargets = providerTargets.filter(target =>
      target.enabled && providerTargetCompatibleWithAgents(target, providerAgents, runtimeCatalog))
  const thinkingOptions = useMemo<Array<ThinkingOption<AgentBatchThinkingEffort>>>(() =>
    AGENT_THINKING_EFFORTS.map((option) => {
      const value = option.value
      return {
        value,
        label: t(thinkingLabelKeys[value]),
        description: t(thinkingDescriptionKeys[value]),
      }
    }), [t])
  const defaultSelection = (() => {
    const providerTarget = defaultBatchProviderTarget(selectedAgents, providerTargets, runtimeCatalog)
    if (!providerTarget) {
      return null
    }
    return {
      providerTarget,
      modelId: defaultBatchModelId(selectedAgents, providerTarget, runtimeCatalog),
      thinkingEffort: defaultBatchThinkingEffort(selectedAgents, runtimeCatalog),
    }
  })()
  const [selectionOverride, setSelectionOverride] = useState<AgentProviderBatchSelection | null>(
    null,
  )
  const selection = selectionOverride ?? defaultSelection
  const initialProviderTargetIds = useMemo(() => [selection?.providerTarget.id ?? null], [selection?.providerTarget.id])
  const {
    modelsByProviderTargetId,
    loadingProviderTargetIds,
    requestProviderTargetModels,
  } = useProviderTargetModelMap(
    selectableProviderTargets,
    initialProviderTargetIds,
  )
  const selectedProviderTargetId = selection?.providerTarget.id ?? null
  const selectedModels = useMemo(
    () => selectedProviderTargetId
      ? (modelsByProviderTargetId[selectedProviderTargetId] ?? [])
      : [],
    [modelsByProviderTargetId, selectedProviderTargetId],
  )
  const selectedModel = selectedModels.find(model => model.id === selection?.modelId) ?? null
  const isLoadingSelectedModels = selectedProviderTargetId
    ? loadingProviderTargetIds.has(selectedProviderTargetId)
    : false

  const resolveThinkingForModel = useCallback((
    model: ModelDescriptor | null,
    current: AgentBatchThinkingEffort,
  ): AgentBatchThinkingEffort =>
    selectSupportedThinkingValue(model, thinkingOptions, current, 'high'), [thinkingOptions])

  const applyProviderTargetSelection = (nextProviderTargetId: string) => {
    requestProviderTargetModels(nextProviderTargetId)
    const nextTarget = selectableProviderTargets.find(target => target.id === nextProviderTargetId)
    const nextModel = (modelsByProviderTargetId[nextProviderTargetId] ?? [])[0] ?? null
    setSelectionOverride({
      providerTarget: nextTarget
        ? providerTargetFromOption(nextTarget)
        : { id: nextProviderTargetId },
      modelId: nextModel?.id ?? null,
      thinkingEffort: nextModel
        ? resolveThinkingForModel(nextModel, selection?.thinkingEffort ?? 'high')
        : selection?.thinkingEffort ?? 'high',
    })
  }

  const applyModelSelection = (nextModelId: string | null, nextProviderTargetId: string) => {
    const nextTarget = selectableProviderTargets.find(target => target.id === nextProviderTargetId)
    const nextModel = nextModelId
      ? ((modelsByProviderTargetId[nextProviderTargetId] ?? []).find(model => model.id === nextModelId) ?? null)
      : null
    setSelectionOverride({
      providerTarget: nextTarget
        ? providerTargetFromOption(nextTarget)
        : { id: nextProviderTargetId },
      modelId: nextModelId,
      thinkingEffort: resolveThinkingForModel(nextModel, selection?.thinkingEffort ?? 'high'),
    })
  }

  useEffect(() => {
    if (!selection || selection.modelId !== null || selectedModels.length === 0) {
      return
    }
    const nextModel = selectedModels[0]!
    setSelectionOverride({
      ...selection,
      modelId: nextModel.id,
      thinkingEffort: resolveThinkingForModel(nextModel, selection.thinkingEffort),
    })
  }, [resolveThinkingForModel, selectedModels, selection])

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex w-full max-w-xl flex-col items-center gap-5 text-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
          <SlidersHorizontalIcon className="size-4" />
        </div>
        <div className="space-y-2">
          <h4 className="font-heading text-sm font-medium tracking-tight text-foreground">
            {t('batch.provider.selected', { count: selectedAgents.length })}
          </h4>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {t('batch.provider.description')}
            {skippedRuntimeOwnedCount > 0 && (
              <>
                {' '}
                {t('batch.provider.skippedRuntimeOwned', { count: skippedRuntimeOwnedCount })}
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <ProviderModelPicker
            providerTargets={selectableProviderTargets}
            selectedProviderTargetId={selectedProviderTargetId}
            selectedModelId={selection?.modelId ?? null}
            selectedModel={selectedModel}
            modelsByProviderTargetId={modelsByProviderTargetId}
            loadingProviderTargetIds={loadingProviderTargetIds}
            thinkingValue={selection?.thinkingEffort ?? 'high'}
            thinkingOptions={thinkingOptions}
            isLoadingSelectedModels={isLoadingSelectedModels}
            emptyProviderTargetsLabel={t('batch.provider.emptyProviderTargets')}
            emptySelectionLabel={t('batch.provider.emptySelection')}
            menuSide="bottom"
            menuAlign="center"
            triggerTestId="agent-batch-provider-model-selector"
            disabled={providerAgents.length === 0}
            getThinkingOptionsForModel={model =>
              filterThinkingOptionsForModel(model, thinkingOptions)}
            onRequestProviderTargetModels={requestProviderTargetModels}
            onSelectProviderTarget={applyProviderTargetSelection}
            onSelectModel={applyModelSelection}
            onSelectThinking={(thinkingEffort) => {
              if (!selection) {
                return
              }
              setSelectionOverride({ ...selection, thinkingEffort })
            }}
          />
          <Button
            size="sm"
            onClick={() => {
              if (selection && selection.modelId !== null) {
                onApply(selection)
              }
            }}
            disabled={busy || !selection || selection.modelId === null || providerAgents.length === 0}
          >
            {t('batch.provider.apply')}
          </Button>
          <Button size="sm" variant="outline" onClick={onClear} disabled={busy}>
            <XIcon />
            {t('batch.provider.clearSelection')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function AgentImportDialog({
  open,
  preview,
  selectedIds,
  busy,
  error,
  onOpenChange,
  onToggleCandidate,
  onImport,
}: {
  open: boolean
  preview: PreviewLocalConfigImportResult | null
  selectedIds: Set<string>
  busy: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onToggleCandidate: (candidateId: string, checked: boolean) => void
  onImport: () => void
}) {
  const importableSelectedCount = preview?.candidates.filter(candidate => candidate.importable && selectedIds.has(candidate.id)).length ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Agents</DialogTitle>
          <DialogDescription>
            Review detected Claude, Codex, Gemini, Pi, Kimi, and CC Switch mappings before creating Agents.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {error && (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {error}
            </div>
          )}

          {!preview && (
            <div className="rounded-md border border-foreground/8 px-3 py-6 text-center text-[12.5px] text-muted-foreground">
              Scanning local config
            </div>
          )}

          {preview && preview.candidates.length === 0 && (
            <div className="rounded-md border border-foreground/8 px-3 py-6 text-center text-[12.5px] text-muted-foreground">
              No Claude, Codex, Gemini, Pi, Kimi, or CC Switch mappings found
            </div>
          )}

          {preview && preview.candidates.length > 0 && (
            <div className="max-h-[420px] overflow-auto rounded-lg border border-foreground/8">
              {preview.candidates.map(candidate => (
                <label
                  key={candidate.id}
                  className={cn(
                    'flex gap-3 border-b border-foreground/6 px-3 py-3 last:border-b-0',
                    candidate.importable ? 'cursor-pointer hover:bg-foreground/[0.025]' : 'opacity-60',
                  )}
                >
                  <Checkbox
                    checked={selectedIds.has(candidate.id)}
                    disabled={!candidate.importable || busy}
                    onCheckedChange={value => onToggleCandidate(candidate.id, Boolean(value))}
                  />
                  {(candidate.avatarUrl || candidate.iconSlug) && (
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-foreground/8 bg-background">
                      {candidate.avatarUrl
                        ? <img src={candidate.avatarUrl} alt="" className="size-5 object-contain" />
                        : <ProviderIcon iconSlug={candidate.iconSlug} presetId={candidate.app} className="size-5" />}
                    </span>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {candidate.agentName}
                      </span>
                      <Badge variant={candidate.sourceKind === 'cc-switch' ? 'secondary' : 'outline'} className="font-normal">
                        {candidate.sourceLabel}
                      </Badge>
                      {candidate.alreadyConfigured && (
                        <Badge variant="outline" className="font-normal">
                          Existing
                        </Badge>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                      <span>{candidate.app}</span>
                      <span className="truncate">{candidate.resolvedProviderName}</span>
                      {candidate.modelId && <span className="truncate">{candidate.modelId}</span>}
                      {candidate.endpoint && <span className="truncate font-mono">{candidate.endpoint}</span>}
                      {candidate.executable && <span className="truncate font-mono">{candidate.executable}</span>}
                    </div>
                    {candidate.notes.map(note => (
                      <p key={note} className="text-[11.5px] leading-relaxed text-muted-foreground">
                        {note}
                      </p>
                    ))}
                    {candidate.reason && (
                      <p className="text-[11.5px] leading-relaxed text-destructive">
                        {candidate.reason}
                      </p>
                    )}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter variant="bare">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={onImport} disabled={busy || importableSelectedCount === 0}>
            <DownloadIcon />
            {busy ? 'Importing' : 'Import selected'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AgentList() {
  const {
    agents,
    isLoading,
    isSuccess: agentsReady,
    importLocalConfig,
    previewLocalConfigImport,
    updateAgent,
    removeAgent,
  } = useAgents()
  const { providerOptions, isSuccess: providerTargetsReady } = useProviderTargets()
  const { runtimes: runtimeCatalog } = useRuntimeCatalog()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const selectionAnchorIdRef = useRef<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importPreview, setImportPreview] = useState<PreviewLocalConfigImportResult | null>(null)
  const [selectedImportCandidateIds, setSelectedImportCandidateIds] = useState<Set<string>>(() => new Set())
  const [importError, setImportError] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const agentFocusTargetId = useSettingsOverlayStore(state => state.agentFocusTarget?.id ?? null)
  const clearAgentFocusTarget = useSettingsOverlayStore(state => state.clearAgentFocusTarget)
  const settingsAgentsReady = agentsReady && providerTargetsReady

  const visibleAgents = (() => {
    if (!filter.trim()) {
      return agents
    }
    const q = filter.trim().toLowerCase()
    return agents.filter(
      a => a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q),
    )
  })()

  const selectedAgentId = selectedIdFromSet(selectedIds)
  const selectedAgent = (selectedAgentId ? agents.find(a => a.id === selectedAgentId) : undefined)
  const selectedAgents = selectedRecords(agents, selectedIds)
  const allVisibleSelected = visibleRecordsAreSelected(visibleAgents, selectedIds)

  useEffect(() => {
    const available = new Set(agents.map(agent => agent.id))
    setSelectedIds(prev => pruneSelectedIds(prev, available))
    if (selectionAnchorIdRef.current && !available.has(selectionAnchorIdRef.current)) {
      selectionAnchorIdRef.current = null
    }
  }, [agents])

  useEffect(() => {
    if (!agentFocusTargetId) {
      return
    }

    const focusedAgent = agents.find(agent => agent.id === agentFocusTargetId)
    if (focusedAgent) {
      setSelectedIds(new Set([focusedAgent.id]))
      selectionAnchorIdRef.current = focusedAgent.id
      setCreateDialogOpen(false)
      setFilter('')
      clearAgentFocusTarget()
      return
    }

    if (agentsReady) {
      clearAgentFocusTarget()
    }
  }, [agentFocusTargetId, agents, agentsReady, clearAgentFocusTarget])

  const openCreateDialog = () => {
    setCreateDialogOpen(true)
  }

  const handleCreated = (newAgentId: string) => {
    setCreateDialogOpen(false)
    setSelectedIds(new Set([newAgentId]))
    selectionAnchorIdRef.current = newAgentId
  }

  const handleDeleted = () => {
    setSelectedIds(new Set())
    selectionAnchorIdRef.current = null
  }

  const openImportDialog = async () => {
    setImportMessage(null)
    setImportError(null)
    setImportDialogOpen(true)
    setImportPreview(null)
    setSelectedImportCandidateIds(new Set())
    try {
      const preview = await previewLocalConfigImport.mutateAsync({ body: {} })
      setImportPreview(preview)
      setSelectedImportCandidateIds(new Set(preview.candidates.filter(candidate => candidate.importable).map(candidate => candidate.id)))
    }
    catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import preview failed')
    }
  }

  const toggleImportCandidate = (candidateId: string, checked: boolean) => {
    setSelectedImportCandidateIds((current) => {
      const next = new Set(current)
      if (checked) {
        next.add(candidateId)
      }
      else {
        next.delete(candidateId)
      }
      return next
    })
  }

  const confirmImportLocalConfig = async () => {
    setImportError(null)
    try {
      const result = await importLocalConfig.mutateAsync({
        body: {
          candidateIds: Array.from(selectedImportCandidateIds),
        },
      })
      const selectedImport = result.agents.find(imported => imported.status === 'created' && imported.agent)
        ?? result.agents.find(imported => imported.status === 'existing' && imported.agent)
      if (selectedImport?.agent) {
        setCreateDialogOpen(false)
        setSelectedIds(new Set([selectedImport.agent.id]))
        selectionAnchorIdRef.current = selectedImport.agent.id
      }

      const parts = [
        result.created > 0 ? `${result.created} imported` : null,
        result.existing > 0 ? `${result.existing} already configured` : null,
        result.skipped > 0 ? `${result.skipped} skipped` : null,
      ].filter(Boolean)
      setImportMessage(parts.join(' · ') || 'No changes')
      setImportDialogOpen(false)
    }
    catch (error) {
      setImportError(error instanceof Error ? error.message : 'Import failed')
    }
  }

  const toggleVisibleSelected = () => {
    setSelectedIds(prev =>
      allVisibleSelected
        ? removeVisibleSelection(prev, visibleAgents)
        : mergeVisibleSelection(prev, visibleAgents))
  }

  const selectVisibleAgents = () => {
    setCreateDialogOpen(false)
    setSelectedIds(prev => mergeVisibleSelection(prev, visibleAgents))
    selectionAnchorIdRef.current = visibleAgents.at(-1)?.id ?? null
  }

  const clearSelection = () => {
    setCreateDialogOpen(false)
    setSelectedIds(new Set())
    selectionAnchorIdRef.current = null
  }

  const selectAgent = (agentId: string, selected: boolean, shiftKey: boolean) => {
      setCreateDialogOpen(false)
      setSelectedIds((prev) => {
        if (shiftKey) {
          return applyVisibleRangeSelection(
            prev,
            visibleAgents,
            selectionAnchorIdRef.current,
            agentId,
            selected,
          )
        }

        const next = new Set(prev)
        if (selected) {
          next.add(agentId)
        }
 else {
          next.delete(agentId)
        }
        return next
      })
      selectionAnchorIdRef.current = agentId
    }

  const openAgent = (agentId: string, shiftKey: boolean) => {
      if (shiftKey) {
        selectAgent(agentId, true, true)
        return
      }

      setSelectedIds(new Set([agentId]))
      selectionAnchorIdRef.current = agentId
      setCreateDialogOpen(false)
    }

  const handleBatchToggle = async (enabled: boolean) => {
      if (selectedAgents.length === 0) {
        return
      }
      setBatchBusy(true)
      try {
        await Promise.all(
          selectedAgents.map(async (agent) => {
            await updateAgent.mutateAsync({
              path: { id: agent.id },
              body: {
                name: agent.name,
                description: agent.description,
                avatarStyle: agent.avatarStyle,
                avatarSeed: agent.avatarSeed,
                providerTargetId: agent.providerTargetId,
                modelId: agent.modelId,
                thinkingEffort: agent.thinkingEffort,
                runtimeKind: agent.runtimeKind,
                configJson: agent.configJson,
                enabled,
              },
            })
          }),
        )
        setSelectedIds(new Set())
        selectionAnchorIdRef.current = null
      }
 finally {
        setBatchBusy(false)
      }
    }

  const handleBatchDelete = async () => {
    if (selectedAgents.length === 0) {
      return
    }
    setBatchBusy(true)
    try {
      await Promise.all(selectedAgents.map(agent => removeAgent.mutateAsync({ path: { id: agent.id } })))
      setSelectedIds(new Set())
      selectionAnchorIdRef.current = null
    }
 finally {
      setBatchBusy(false)
    }
  }

  const handleBatchConfigureProvider = async (selection: AgentProviderBatchSelection) => {
      const { patches } = buildAgentProviderBatchPatches(selectedAgents, selection, runtimeCatalog)
      if (patches.length === 0) {
        return
      }

      setBatchBusy(true)
      try {
        await Promise.all(
          patches.map(({ id, patch }) =>
            updateAgent.mutateAsync({
              path: { id },
              body: patch,
            })),
        )
        setSelectedIds(new Set())
        selectionAnchorIdRef.current = null
      }
 finally {
        setBatchBusy(false)
      }
    }

  const selectionShortcutScopeRef = useSettingsSelectionShortcuts({
    hasVisibleRecords: visibleAgents.length > 0,
    hasSelection: selectedIds.size > 0,
    hasDraft: false,
    canDeleteSelection: !batchBusy && selectedAgents.length > 0,
    onSelectVisible: selectVisibleAgents,
    onClearSelection: clearSelection,
    onDeleteSelection: () => {
      void handleBatchDelete()
    },
  })

  const headerActions = (
    <div className="flex shrink-0 items-center gap-2">
      {importMessage && (
        <span className="max-w-52 truncate text-[11.5px] text-muted-foreground">
          {importMessage}
        </span>
      )}
      <Button
        data-testid="import-agent-btn"
        size="sm"
        variant="outline"
        onClick={() => void openImportDialog()}
        disabled={previewLocalConfigImport.isPending || importLocalConfig.isPending}
      >
        <DownloadIcon />
        {previewLocalConfigImport.isPending ? 'Scanning' : 'Import'}
      </Button>
      <Button data-testid="new-agent-btn" size="sm" onClick={openCreateDialog} disabled={createDialogOpen}>
        <PlusIcon />
        Add agent
      </Button>
    </div>
  )

  const toolbar = selectedIds.size > 0
    ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <button
              type="button"
              onClick={toggleVisibleSelected}
              className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-foreground/[0.035]"
            >
              {allVisibleSelected
                ? <SquareCheckIcon className="size-3.5" />
                : <SquareIcon className="size-3.5" />}
              <span>
                {selectedIds.size}
                {' '}
                selected
              </span>
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="text-muted-foreground/70 hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleBatchToggle(true)}
              disabled={batchBusy || selectedAgents.length === 0}
            >
              Enable
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleBatchToggle(false)}
              disabled={batchBusy || selectedAgents.length === 0}
            >
              Disable
            </Button>
            <Button
              size="xs"
              variant="destructive"
              onClick={() => void handleBatchDelete()}
              disabled={batchBusy || selectedAgents.length === 0}
            >
              <Trash2Icon className="size-3" />
              Delete
            </Button>
          </div>
        </div>
      )
    : null

  const listPane = (
    <div
      ref={selectionShortcutScopeRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3"
    >
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 !text-muted-foreground/60" />
        <Input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search agents"
          className="h-8 pl-8 pr-2 text-[12.5px]"
        />
      </div>

      <ScrollArea className="-mx-1 min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-1">
          {visibleAgents.length > 0 && (
            <div className="mb-1 flex items-center justify-between gap-2 px-2 py-0.5 text-[10.5px] text-muted-foreground/60">
              <span>
                {visibleAgents.length}
                {' '}
                visible
              </span>
              <button
                type="button"
                onClick={toggleVisibleSelected}
                className="text-muted-foreground/70 hover:text-foreground"
              >
                {allVisibleSelected ? 'Unselect visible' : 'Select visible'}
              </button>
            </div>
          )}

          {!isLoading
            && visibleAgents.map(agent => (
              <AgentSidebarRow
                key={agent.id}
                agent={agent}
                providerTargets={providerOptions}
                runtimeCatalog={runtimeCatalog}
                active={selectedAgentId === agent.id}
                selected={selectedIds.has(agent.id)}
                onClick={shiftKey => openAgent(agent.id, shiftKey)}
                onToggleSelected={(checked, shiftKey) =>
                  selectAgent(agent.id, checked, shiftKey)}
              />
            ))}

          {!isLoading && visibleAgents.length === 0 && (
            <div className="px-2 py-6 text-center" data-testid="agent-empty-state">
              <p className="text-[11.5px] text-muted-foreground/70">
                {filter ? 'No matches' : 'No agents yet'}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      {agents.length > 0 && (
        <div className="px-1 pb-1 pt-1 text-[10.5px] tabular-nums text-muted-foreground/60">
          {agents.length}
          {' '}
          agent
          {agents.length === 1 ? '' : 's'}
          {' '}
          ·
          {agents.filter(a => a.enabled).length}
          {' '}
          active
        </div>
      )}
    </div>
  )

  const detailPane = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col py-5 pl-6 pr-5">
      {selectedAgents.length > 1
          ? (
              <AgentBatchProviderPanel
                key={selectedAgents.map(agent => agent.id).join('|')}
                selectedAgents={selectedAgents}
                providerTargets={providerOptions}
                runtimeCatalog={runtimeCatalog}
                busy={batchBusy}
                onApply={selection => void handleBatchConfigureProvider(selection)}
                onClear={clearSelection}
              />
            )
          : selectedAgent
            ? (
                <div key={selectedAgent.id} className="flex-1">
                  <AgentDetailPage
                    agent={selectedAgent}
                    onDeleted={handleDeleted}
                  />
                </div>
              )
            : (
                <div className="flex flex-1 items-center justify-center">
                  <Empty className="border-none">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <BotIcon />
                      </EmptyMedia>
                      <EmptyTitle>No agent selected</EmptyTitle>
                      <EmptyDescription>
                        Pick an agent on the left to view its configuration, or add a new one to get
                        started.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button size="sm" variant="outline" onClick={openCreateDialog}>
                        <PlusIcon />
                        Add agent
                      </Button>
                    </EmptyContent>
                  </Empty>
                </div>
              )}
    </div>
  )

  return (
    <SettingsMasterDetail
      data-testid="agent-list"
      data-settings-agents-ready={settingsAgentsReady ? 'true' : 'false'}
      title="Agents"
      description="Create AI agents with unique identities, personas, and provider targets."
      action={headerActions}
      toolbar={toolbar}
      list={listPane}
      detail={detailPane}
    >
      <CreateAgentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={handleCreated}
      />
      <AgentImportDialog
        open={importDialogOpen}
        preview={importPreview}
        selectedIds={selectedImportCandidateIds}
        busy={previewLocalConfigImport.isPending || importLocalConfig.isPending}
        error={importError}
        onOpenChange={setImportDialogOpen}
        onToggleCandidate={toggleImportCandidate}
        onImport={() => void confirmImportLocalConfig()}
      />
    </SettingsMasterDetail>
  )
}
