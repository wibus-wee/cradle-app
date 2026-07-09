import {
  CheckCircleLine as CheckCircle2Icon,
  EyeLine as EyeIcon,
  HeartbeatLine as ActivityIcon,
  ListCheckLine as ListChecksIcon,
  RobotLine as BotIcon,
  RoundLine as CircleIcon,
  StopwatchLine as TimerIcon,
  ToolLine as WrenchIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import type { UIMessage } from 'ai'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { useRuntimeCatalog } from '~/features/agent-runtime/use-runtime-catalog'
import { cn } from '~/lib/cn'
import { formatElapsedRangeMs, formatPercentFromRatio } from '~/lib/number-format'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useLayoutStore } from '~/store/layout'

import type {
  ChatRuntimeCrewAgentItem,
  ChatRuntimeCrewCallItem,
  ChatRuntimeCrewUiSlotState,
  ChatRuntimePlanUiSlotState,
  ChatRuntimeProgressUiSlotState,
  ChatRuntimeUiSlotState,
} from '../capabilities/chat-capabilities'
import {
  getChatRuntimeUiSlotStates,
  runtimeUiSlotStatesQueryKey,
} from '../capabilities/chat-capabilities'
import type { ChatTodoItem, SessionTodoSnapshot } from '../capabilities/chat-todo-projection'
import type { RuntimeSessionStatusKind } from '../commands/runtime-session-status-command'
import { readChatAttentionSnapshot, subscribeChatAttentionSnapshots } from '../context/chat-context'
import { readRenderableToolPart } from '../rendering/chat-render-plan'
import { toolNameFromPart } from '../rendering/chat-tool-entities'
import { SubagentIdenticon } from '../rendering/subagent-identicon'
import type { RenderableToolPart, ToolState } from '../rendering/tool-ui-classifier'
import { describeToolCall, formatToolName } from '../rendering/tool-ui-classifier'
import { useSessionTodos } from '../session/use-session-todos'
import {
  formatRuntimeSettingsSummary,
  readComposerRuntimeSettingsFields,
  resolveRuntimeCatalogItem,
} from './runtime-settings-presenter'
import { useRuntimeSessionStatus } from './use-runtime-session-status'

interface RuntimeSessionPanelProps {
  sessionId: string | null
  runtimeKind?: RuntimeKind | null
  providerTargetId?: string | null
  active?: boolean
}

const TOOL_STATE_LABELS: Record<ToolState, string> = {
  'input-streaming': 'Input',
  'input-available': 'Ready',
  'approval-requested': 'Approval',
  'approval-responded': 'Approved',
  'output-available': 'Done',
  'output-error': 'Error',
  'output-denied': 'Denied',
}

const EMPTY_MESSAGES: UIMessage[] = []
const subscribeInactiveChatAttentionSnapshots = () => () => undefined

type ProgressTaskStatus = 'pending' | 'inProgress' | 'completed'

interface ProgressTaskItem {
  id: string
  label: string
  status: ProgressTaskStatus
  order: number
}

export function RuntimeSessionPanel({
  sessionId,
  runtimeKind,
  providerTargetId,
  active = true,
}: RuntimeSessionPanelProps) {
  const { t } = useTranslation('chat')
  const { runtimes } = useRuntimeCatalog()
  const activeSessionId = active ? sessionId : null
  const visibleStatus = useChatStore(
    activeSessionId ? chatSelectors.visibleStatus(activeSessionId) : () => 'idle' as const,
  )
  const { data: runtimeStatus } = useRuntimeSessionStatus(activeSessionId, active, {
    refetchInterval: false,
  })
  const effectiveRuntimeKind = runtimeStatus?.runtimeKind ?? runtimeKind ?? null
  const runtimeCatalogItem = resolveRuntimeCatalogItem(runtimes, effectiveRuntimeKind)
  const runtimeSettingsFields = readComposerRuntimeSettingsFields(runtimeCatalogItem)
  const runtimeSettingsSummary = formatRuntimeSettingsSummary(
    t,
    runtimeSettingsFields,
    runtimeStatus?.runtimeSettings ?? {},
  )
  const attentionSnapshot = useSyncExternalStore(
    active ? subscribeChatAttentionSnapshots : subscribeInactiveChatAttentionSnapshots,
    () => (active ? readChatAttentionSnapshot(sessionId) : null),
    () => null,
  )
  const { data: runtimeUiSlotStates, isLoading: runtimeUiSlotStatesLoading } = useQuery({
    queryKey: runtimeUiSlotStatesQueryKey(activeSessionId, runtimeKind),
    queryFn: ({ signal }) => getChatRuntimeUiSlotStates(activeSessionId!, signal),
    enabled: !!activeSessionId,
    staleTime: 2_000,
    refetchInterval: (query) => {
      if (!active) {
        return false
      }
      return statusShouldPoll(runtimeStatus?.status)
        || shouldPollRuntimeSlotStates(query.state.data?.states ?? [])
        ? 2_000
        : false
    },
    retry: false,
  })
  const todoSnapshot = useSessionTodos(sessionId, active)
  const lastAssistantId = useChatStore(
    activeSessionId ? chatSelectors.lastAssistantId(activeSessionId) : () => undefined,
  )
  const messages = useChatStore(
    activeSessionId ? chatSelectors.messages(activeSessionId) : () => EMPTY_MESSAGES,
  )
  const tools = collectSessionToolParts(messages)
  const runMeta = useChatStore(
    active && lastAssistantId ? chatSelectors.runDisplayMeta(lastAssistantId) : () => undefined,
  )
  const toolCounts = countToolStates(tools)
  const recentTools = tools.slice(-6).reverse()
  const status = runtimeStatus?.status ?? visibleStatus
  const displayedRun = runtimeStatus?.activeRun ?? runtimeStatus?.latestRun ?? null
  const planState = runtimeUiSlotStates?.states.find(isRuntimePlanState) ?? null
  const progressStates = runtimeUiSlotStates?.states.filter(isRuntimeProgressState) ?? []
  const crewState = runtimeUiSlotStates?.states.find(isRuntimeCrewState) ?? null
  const progressItems = buildProgressItems(planState, progressStates, todoSnapshot)

  if (!sessionId) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center">
        <p className="text-[11px] text-muted-foreground">No session selected</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-3">
      <ProgressPanel items={progressItems} loading={runtimeUiSlotStatesLoading} />
      <SubagentsPanel sessionId={sessionId} crewState={crewState} />

      <div className="border-t" />

      <section className="space-y-2">
        <PanelHeading icon={EyeIcon} label="Attention" />
        {attentionSnapshot
? (
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Visible" value={formatAttentionRange(attentionSnapshot)} />
            <Metric label="Scroll" value={formatPercentFromRatio(attentionSnapshot.scrollRatio)} />
            <Metric label="Focus" value={attentionSnapshot.focusedArea ?? 'none'} />
            <Metric
              label="Freshness"
              value={formatSnapshotFreshness(attentionSnapshot.updatedAt)}
            />
          </div>
        )
: (
          <p className="rounded-md bg-muted/30 p-2 text-[11px] text-muted-foreground">
            No chat attention snapshot for this session
          </p>
        )}
      </section>

      <div className="border-t" />

      <section className="space-y-2">
        <PanelHeading icon={ActivityIcon} label="Session" />
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Runtime status" value={formatStatus(status)} tone={status} />
          <Metric label="UI status" value={formatStatus(visibleStatus)} tone={visibleStatus} />
          <Metric label="Runtime" value={runtimeStatus?.runtimeKind ?? runtimeKind ?? 'unknown'} />
          <Metric label="Mode" value={runtimeSettingsSummary} />
          <Metric
            label="Provider"
            value={runtimeStatus?.providerTargetId ?? providerTargetId ?? 'default'}
            className="col-span-2"
          />
        </div>
      </section>

      <section className="space-y-2">
        <PanelHeading icon={TimerIcon} label="Run" />
        <div className="space-y-1.5 rounded-md bg-muted/40 p-2">
          <KeyValue label="Run ID" value={displayedRun?.runId ?? runMeta?.runId ?? 'none'} />
          <KeyValue label="Run status" value={displayedRun?.status ?? 'none'} />
          <KeyValue
            label="Provider session"
            value={runtimeStatus?.providerSessionId ?? displayedRun?.providerSessionId ?? 'none'}
          />
          <KeyValue
            label="Model"
            value={runtimeStatus?.modelId ?? displayedRun?.modelId ?? 'none'}
          />
          <KeyValue
            label="First event"
            value={formatElapsedRangeMs(runMeta?.requestStartedAtMs, runMeta?.firstEventAtMs)}
          />
          <KeyValue
            label="First content"
            value={formatElapsedRangeMs(runMeta?.requestStartedAtMs, runMeta?.firstContentAtMs)}
          />
          <KeyValue
            label="Total"
            value={formatElapsedRangeMs(runMeta?.requestStartedAtMs, runMeta?.completedAtMs)}
          />
          <KeyValue
            label="Queue"
            value={`${runtimeStatus?.queue.running ?? 0} running / ${runtimeStatus?.queue.pending ?? 0} pending`}
          />
        </div>
      </section>

      <section className="space-y-2">
        <PanelHeading icon={WrenchIcon} label="Tool calls" />
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Total" value={String(tools.length)} />
          <Metric label="Running" value={String(toolCounts.running)} />
          <Metric
            label="Failed"
            value={String(toolCounts.failed)}
            tone={toolCounts.failed > 0 ? 'error' : 'idle'}
          />
        </div>
        <div className="space-y-1.5">
          {recentTools.length === 0 && (
            <p className="rounded-md bg-muted/30 p-2 text-[11px] text-muted-foreground">
              No tool calls for this session
            </p>
          )}
          {recentTools.map((tool) => {
            const descriptor = describeToolCall(tool)
            const toolName = toolNameFromPart(tool)
            return (
              <div key={tool.toolCallId} className="rounded-md bg-muted/40 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <CircleIcon
                    className={cn(
                      'size-2.5 shrink-0 fill-current',
                      tool.state === 'output-error' ? '!text-destructive' : '!text-muted-foreground',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                    {descriptor.title || formatToolName(toolName)}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {TOOL_STATE_LABELS[tool.state]}
                  </span>
                </div>
                {descriptor.target && (
                  <p className="mt-0.5 truncate pl-4 text-[10px] text-muted-foreground">
                    {descriptor.target}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function PanelHeading({ icon: Icon, label }: { icon: typeof ActivityIcon, label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

function ProgressPanel({ items, loading }: { items: ProgressTaskItem[], loading: boolean }) {
  if (items.length === 0) {
    return null
  }
  return (
    <section className="space-y-2">
      <PanelHeading icon={ListChecksIcon} label="Progress" />
      <div className="space-y-2 rounded-md bg-muted/35 px-1 py-2 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        {items.length > 0
? (
          <div className="space-y-1">
            {items.map(item => (
              <ProgressTaskRow key={item.id} item={item} />
            ))}
          </div>
        )
: (
          <p className="rounded bg-background/45 px-2 py-1.5 text-[11px] text-muted-foreground">
            {loading ? 'Loading session progress...' : 'No Plan or TODO state for this session'}
          </p>
        )}
      </div>
    </section>
  )
}

function ProgressTaskRow({ item }: { item: ProgressTaskItem }) {
  const Icon
    = item.status === 'completed'
      ? CheckCircle2Icon
      : item.status === 'inProgress'
        ? Spinner
        : CircleIcon

  return (
    <div className="flex min-w-0 items-start gap-2 rounded bg-background/45 px-2 py-1.5">
      <Icon
        className={cn(
          'mt-0.5 size-3.5 shrink-0',
          item.status === 'completed' && '!text-emerald-600 dark:!text-emerald-400',
          item.status === 'inProgress' && 'animate-spin !text-primary',
          item.status === 'pending' && '!text-muted-foreground',
        )}
      />
      <span
        className={cn(
          'min-w-0 flex-1 text-[11px] leading-4 text-foreground/85',
          item.status === 'completed'
          && 'text-muted-foreground line-through decoration-muted-foreground/50',
        )}
      >
        {item.label}
      </span>
    </div>
  )
}

function SubagentsPanel({
  sessionId,
  crewState,
}: {
  sessionId: string
  crewState: ChatRuntimeCrewUiSlotState | null
}) {
  const openSubagentTab = useBrowserPanelStore(state => state.openSubagentTab)
  const browserPanelOwnerId = useLayoutStore(state => state.activeBrowserPanelOwnerId)
  const setBrowserPanelOpen = useLayoutStore(state => state.setBrowserPanelOpen)
  const agents = crewState ? readCrewAgents(crewState) : []
  const openAgent = (agent: ChatRuntimeCrewAgentItem) => {
    openSubagentTab({
      sessionId,
      threadId: agent.threadId,
      agentName: readCrewAgentLabel(agent),
      agentRole: agent.agentRole,
      ownerId: browserPanelOwnerId,
    })
    setBrowserPanelOpen(true, browserPanelOwnerId)
  }

  if (agents.length === 0) {
    return null
  }

  return (
    <section className="space-y-2">
      <PanelHeading icon={BotIcon} label="Subagents" />
      <div className="space-y-2 rounded-md bg-muted/35 p-2 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="space-y-1">
          {agents.map(agent => (
            <SubagentRow key={agent.threadId} agent={agent} onOpen={openAgent} />
          ))}
        </div>
      </div>
    </section>
  )
}

function SubagentRow({
  agent,
  onOpen,
}: {
  agent: ChatRuntimeCrewAgentItem
  onOpen: (agent: ChatRuntimeCrewAgentItem) => void
}) {
  const label = readCrewAgentLabel(agent)
  const isActive = isActiveCrewAgentStatus(agent.status)

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-10 min-w-0 w-full justify-start gap-2 rounded bg-background/45 px-2 text-left hover:bg-background/70 focus-visible:ring-1 focus-visible:ring-ring"
      onClick={() => onOpen(agent)}
      aria-label={`Open ${label} output`}
    >
      <SubagentIdenticon
        active={isActive}
        seed={agent.threadId}
        className="size-5 pointer-events-none"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
        {label}
      </span>
    </Button>
  )
}

function Metric({
  label,
  value,
  tone = 'idle',
  className,
}: {
  label: string
  value: string
  tone?: RuntimeSessionStatusKind | 'error'
  className?: string
}) {
  return (
    <div className={cn('min-w-0 rounded-md bg-muted/40 p-2', className)}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 truncate text-[11px] font-medium',
          tone === 'streaming' && 'text-primary',
          tone === 'pending' && 'text-primary',
          tone === 'waitingForUserInput' && 'text-amber-600 dark:text-amber-400',
          tone === 'cancelling' && 'text-amber-600 dark:text-amber-400',
          tone === 'error' && 'text-destructive',
          tone === 'idle' && 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function KeyValue({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-foreground">
        {value}
      </span>
    </div>
  )
}

function isRuntimePlanState(state: ChatRuntimeUiSlotState): state is ChatRuntimePlanUiSlotState {
  return state.kind === 'plan'
}

function isRuntimeProgressState(state: ChatRuntimeUiSlotState): state is ChatRuntimeProgressUiSlotState {
  return state.kind === 'progress'
}

function isRuntimeCrewState(state: ChatRuntimeUiSlotState): state is ChatRuntimeCrewUiSlotState {
  return state.kind === 'crew'
}

function buildProgressItems(
  planState: ChatRuntimePlanUiSlotState | null,
  progressStates: ChatRuntimeProgressUiSlotState[],
  todoSnapshot: SessionTodoSnapshot | null,
): ProgressTaskItem[] {
  const itemByKey = new Map<string, ProgressTaskItem>()

  planState?.steps.forEach((step, index) => {
    mergeProgressItem(itemByKey, {
      id: `plan:${index}:${step.step}`,
      label: step.step,
      status: step.status,
      order: index,
    })
  })

  progressStates.forEach((state, stateIndex) => {
    state.items.forEach((item, index) => {
      mergeProgressItem(itemByKey, {
        id: `progress:${state.slotId}:${item.id ?? index}:${item.label}`,
        label: item.label,
        status: item.status,
        order: (planState?.steps.length ?? 0) + stateIndex * 1_000 + index,
      })
    })
  })

  const fallbackTodoSnapshot = progressStates.length > 0 ? null : todoSnapshot
  fallbackTodoSnapshot?.todos.forEach((todo, index) => {
    mergeProgressItem(itemByKey, {
      id: `todo:${todo.id ?? index}:${todo.content}`,
      label: todo.content,
      status: mapTodoProgressStatus(todo),
      order: (planState?.steps.length ?? 0) + progressStates.length * 1_000 + index,
    })
  })

  return Array.from(itemByKey.values()).sort((left, right) => left.order - right.order)
}

function mergeProgressItem(itemByKey: Map<string, ProgressTaskItem>, item: ProgressTaskItem): void {
  const key = normalizeProgressLabel(item.label)
  const existing = itemByKey.get(key)
  if (!existing) {
    itemByKey.set(key, item)
    return
  }

  itemByKey.set(key, {
    ...existing,
    id: existing.id,
    status: readDominantProgressStatus(existing.status, item.status),
    order: Math.min(existing.order, item.order),
  })
}

function normalizeProgressLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

function mapTodoProgressStatus(todo: ChatTodoItem): ProgressTaskStatus {
  switch (todo.status) {
    case 'completed':
      return 'completed'
    case 'processing':
      return 'inProgress'
    case 'todo':
    default:
      return 'pending'
  }
}

function readDominantProgressStatus(
  left: ProgressTaskStatus,
  right: ProgressTaskStatus,
): ProgressTaskStatus {
  if (left === 'inProgress' || right === 'inProgress') {
    return 'inProgress'
  }
  if (left === 'completed' || right === 'completed') {
    return 'completed'
  }
  return 'pending'
}

function readCrewAgents(state: ChatRuntimeCrewUiSlotState): ChatRuntimeCrewAgentItem[] {
  if (Array.isArray(state.agents) && state.agents.length > 0) {
    return state.agents
  }
  const agents = new Map<string, ChatRuntimeCrewAgentItem>()
  for (const call of readCrewCalls(state)) {
    for (const threadId of readCrewCallReceiverThreadIds(call)) {
      agents.set(threadId, {
        threadId,
        status: null,
        message: null,
        name: null,
        preview: null,
        modelProvider: null,
        agentNickname: null,
        agentRole: null,
      })
    }
    for (const agent of readCrewCallAgents(call)) {
      agents.set(agent.threadId, agent)
    }
  }
  return Array.from(agents.values())
}

function readCrewCalls(state: ChatRuntimeCrewUiSlotState | null): ChatRuntimeCrewCallItem[] {
  return Array.isArray(state?.calls) ? state.calls : []
}

function readCrewCallAgents(call: ChatRuntimeCrewCallItem): ChatRuntimeCrewAgentItem[] {
  return Array.isArray(call.agents) ? call.agents : []
}

function readCrewCallReceiverThreadIds(call: ChatRuntimeCrewCallItem): string[] {
  return Array.isArray(call.receiverThreadIds) ? call.receiverThreadIds : []
}

function readCrewAgentLabel(agent: ChatRuntimeCrewAgentItem): string {
  return agent.agentNickname ?? agent.name ?? agent.agentRole ?? agent.preview ?? agent.message ?? formatThreadId(agent.threadId)
}

function isActiveCrewAgentStatus(status: string | null): boolean {
  return status === 'pendingInit' || status === 'running' || status === 'active'
}

function countToolStates(tools: Array<{ state: ToolState }>): { running: number, failed: number } {
  return tools.reduce(
    (counts, tool) => {
      if (tool.state === 'output-error' || tool.state === 'output-denied') {
        return { ...counts, failed: counts.failed + 1 }
      }
      if (tool.state !== 'output-available') {
        return { ...counts, running: counts.running + 1 }
      }
      return counts
    },
    { running: 0, failed: 0 },
  )
}

function collectSessionToolParts(messages: UIMessage[]): RenderableToolPart[] {
  const tools: RenderableToolPart[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      const tool = readRenderableToolPart(part)
      if (tool) {
        tools.push(tool)
      }
    }
  }
  return tools
}

function formatStatus(status: RuntimeSessionStatusKind | 'error'): string {
  if (status === 'waitingForUserInput') {
    return 'Waiting for user input'
  }
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatThreadId(threadId: string): string {
  if (threadId.length <= 18) {
    return threadId
  }
  return `${threadId.slice(0, 8)}...${threadId.slice(-4)}`
}

function formatAttentionRange(
  snapshot: NonNullable<ReturnType<typeof readChatAttentionSnapshot>>,
): string {
  if (snapshot.firstVisibleIndex === null || snapshot.lastVisibleIndex === null) {
    return `${snapshot.messageCount} messages`
  }
  return `${snapshot.firstVisibleIndex + 1}-${snapshot.lastVisibleIndex + 1}/${snapshot.messageCount}`
}

function formatSnapshotFreshness(updatedAt: number): string {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - updatedAt) / 1_000))
  if (ageSeconds < 5) {
    return 'live'
  }
  if (ageSeconds < 60) {
    return `${ageSeconds}s ago`
  }
  return `${Math.floor(ageSeconds / 60)}m ago`
}

function statusShouldPoll(status: RuntimeSessionStatusKind | undefined): boolean {
  return status === 'streaming'
    || status === 'pending'
    || status === 'waitingForUserInput'
    || status === 'cancelling'
}

function shouldPollRuntimeSlotStates(states: ChatRuntimeUiSlotState[]): boolean {
  return states.some((state) => {
    if (state.kind === 'plan') {
      return state.inProgressCount > 0
    }
    if (state.kind === 'progress') {
      return state.inProgressCount > 0
    }
    if (state.kind === 'status') {
      return state.status === 'active'
    }
    if (state.kind === 'toolActivity') {
      return typeof state.activeCount === 'number' && state.activeCount > 0
    }
    if (state.kind === 'mcp') {
      return Boolean(state.recentProgress)
    }
    if (state.kind === 'crew') {
      return typeof state.activeCount === 'number' && state.activeCount > 0
    }
    if (state.kind === 'userInput') {
      return true
    }
    return false
  })
}
