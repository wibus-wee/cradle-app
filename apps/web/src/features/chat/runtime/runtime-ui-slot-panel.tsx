import {
  ChipLine as CpuIcon,
  CodeLine as Code2Icon,
  DriveLine as HardDriveIcon,
  FlashLine as ZapIcon,
  GitCompareLine as FileDiffIcon,
  GitPullRequestLine as GitPullRequestIcon,
  HeartbeatLine as ActivityIcon,
  Key2Line as KeyRoundIcon,
  ListCheckLine as ListChecksIcon,
  PackageLine as PackageIcon,
  Plugin2Line,
  QuestionLine as HelpCircleIcon,
  RobotLine as BotIcon,
  RoundLine as CircleIcon,
  SearchLine as SearchIcon,
  ServerLine as ServerIcon,
  Settings2Line as Settings2Icon,
  SparklesLine as SparklesIcon,
  TerminalLine as TerminalIcon,
  ToolLine as WrenchIcon,
  TreeLine as FolderTreeIcon,
  WarningLine as AlertTriangleIcon,
} from '@mingcute/react'
import type { ComponentType, SVGProps } from 'react'

import { Progress } from '~/components/ui/progress'
import { cn } from '~/lib/cn'
import { clampPercent } from '~/lib/number-format'

import type {
  ChatRuntimeApprovalStatus,
  ChatRuntimeCrewAgentItem,
  ChatRuntimeCrewCallItem,
  ChatRuntimeCrewCollaborationMode,
  ChatRuntimeCrewUiSlotState,
  ChatRuntimeMcpServerStatus,
  ChatRuntimeToolActivityStatus,
  ChatRuntimeUiSlot,
  ChatRuntimeUiSlotIconKey,
  ChatRuntimeUiSlotState,
  ChatRuntimeUiSlotSurface,
} from '../capabilities/chat-capabilities'

interface RuntimeUiSlotPanelProps {
  slots: ChatRuntimeUiSlot[]
  states: ChatRuntimeUiSlotState[]
  loading?: boolean
}

type SlotGroupKey = 'environment' | 'activity' | 'available'
type SlotTone = 'neutral' | 'active' | 'success' | 'warning' | 'error' | 'muted'

type SlotIconComponent = ComponentType<SVGProps<SVGSVGElement>>

interface SlotCardModel {
  id: string
  group: SlotGroupKey
  label: string
  description: string
  icon: SlotIconComponent
  tone: SlotTone
  summary: string
  meta: string | null
  progress: number | null
  lines: SlotCardLine[]
  state: ChatRuntimeUiSlotState | null
  slot: ChatRuntimeUiSlot | null
}

interface SlotCardLine {
  label: string
  value: string
  tone?: SlotTone
}

const GROUP_LABELS: Record<SlotGroupKey, string> = {
  environment: 'Environment',
  activity: 'Activity',
  available: 'Available',
}

const GROUP_ORDER: SlotGroupKey[] = ['environment', 'activity', 'available']

const RUNTIME_PANEL_OWNED_ELSEWHERE = new Set<ChatRuntimeUiSlotState['kind']>([
  'compact',
  'goal',
  'plan',
  'progress',
])

const RUNTIME_PANEL_EXCLUDED_ICON_KEYS = new Set<ChatRuntimeUiSlotIconKey>([
  'compact',
  'goal',
  'plan',
  'progress',
])

const KIND_GROUPS: Partial<Record<ChatRuntimeUiSlotState['kind'], SlotGroupKey>> = {
  alert: 'activity',
  approvals: 'activity',
  config: 'environment',
  crew: 'activity',
  diff: 'activity',
  filesystem: 'activity',
  mcp: 'environment',
  model: 'environment',
  plugin: 'environment',
  progress: 'activity',
  reasoning: 'environment',
  search: 'activity',
  skills: 'environment',
  status: 'environment',
  terminal: 'activity',
  toolActivity: 'activity',
  usage: 'environment',
  userInput: 'activity',
}

const STATE_ORDER: Record<ChatRuntimeUiSlotState['kind'], number> = {
  goal: 10,
  plan: 20,
  progress: 25,
  compact: 30,
  status: 100,
  model: 110,
  reasoning: 120,
  config: 130,
  usage: 140,
  mcp: 150,
  skills: 160,
  plugin: 170,
  userInput: 190,
  toolActivity: 200,
  crew: 210,
  diff: 220,
  terminal: 230,
  approvals: 240,
  filesystem: 250,
  search: 260,
  alert: 270,
}

const SURFACE_LABELS: Record<ChatRuntimeUiSlotSurface, string> = {
  composerState: 'Composer',
  messageInline: 'Inline',
  recordOnly: 'Record',
  runtimePanel: 'Panel',
  slashCommand: 'Command',
  streamEvidence: 'Stream',
  toolbarPicker: 'Picker',
}

export function RuntimeUiSlotPanel({ slots, states, loading = false }: RuntimeUiSlotPanelProps) {
  const cards = buildSlotCards(slots, states)

  if (cards.length === 0) {
    return (
      <section className="space-y-2">
        <PanelHeading icon={Settings2Icon} label="Environment" />
        <p className="rounded-md bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
          {loading ? 'Loading provider UI slots...' : 'No provider UI slot state for this session'}
        </p>
      </section>
    )
  }

  return (
    <>
      {GROUP_ORDER.map((group) => {
        const groupCards = cards.filter(card => card.group === group)
        if (groupCards.length === 0) {
          return null
        }
        return (
          <section key={group} className="space-y-2">
            <PanelHeading icon={readGroupIcon(group)} label={GROUP_LABELS[group]} />
            <div className="space-y-1.5">
              {groupCards.map(card => (
                <SlotStateCard key={card.id} card={card} />
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

function buildSlotCards(
  slots: ChatRuntimeUiSlot[],
  states: ChatRuntimeUiSlotState[],
): SlotCardModel[] {
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const stateCards = states
    .map((state) => {
      const slot = slotById.get(state.slotId) ?? null
      if (RUNTIME_PANEL_OWNED_ELSEWHERE.has(state.kind)) {
        return null
      }
      if (slot && !shouldRenderRuntimePanelSlot(slot)) {
        return null
      }
      return projectStateCard(state, slot)
    })
    .filter((card): card is SlotCardModel => card !== null)

  const stateSlotIds = new Set(states.map(state => state.slotId))
  const capabilityCards: SlotCardModel[] = []
  for (const slot of slots) {
    if (!stateSlotIds.has(slot.id) && shouldRenderRuntimePanelSlot(slot)) {
      capabilityCards.push(projectCapabilityCard(slot))
    }
  }

  return [...stateCards, ...capabilityCards].sort((a, b) => {
    if (a.group !== b.group) {
      return GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
    }
    const orderDiff = readCardOrder(a) - readCardOrder(b)
    return orderDiff === 0 ? a.label.localeCompare(b.label) : orderDiff
  })
}

function shouldRenderRuntimePanelSlot(slot: ChatRuntimeUiSlot | null): boolean {
  if (!slot || !slot.surfaces.includes('runtimePanel')) {
    return false
  }
  if (slot.iconKey && RUNTIME_PANEL_EXCLUDED_ICON_KEYS.has(slot.iconKey)) {
    return false
  }
  return slot.name !== 'compact' && slot.name !== 'goal' && slot.name !== 'plan'
}

function projectStateCard(
  state: ChatRuntimeUiSlotState,
  slot: ChatRuntimeUiSlot | null,
): SlotCardModel {
  const view = readStateView(state)
  return {
    id: state.slotId,
    group: KIND_GROUPS[state.kind] ?? 'activity',
    label: slot?.label ?? readFallbackStateLabel(state.kind),
    description: slot?.description ?? '',
    icon: readSlotIcon(slot?.iconKey, state.kind),
    slot,
    state,
    ...view,
  }
}

function projectCapabilityCard(slot: ChatRuntimeUiSlot): SlotCardModel {
  return {
    id: slot.id,
    group: slot.surfaces.includes('toolbarPicker') ? 'environment' : 'available',
    label: slot.label,
    description: slot.description,
    icon: readSlotIcon(slot.iconKey),
    tone: 'muted',
    summary: 'Available',
    meta: formatSurfaces(slot.surfaces),
    progress: null,
    lines: [
      { label: 'Surface', value: formatSurfaces(slot.surfaces) },
      { label: 'Command', value: slot.commandText?.trim() || 'none' },
    ],
    state: null,
    slot,
  }
}

function SlotStateCard({ card }: { card: SlotCardModel }) {
  const Icon = card.icon
  const surfaces = card.slot ? formatSurfaces(card.slot.surfaces) : null
  return (
    <article
      className="rounded-md bg-muted/40 p-2 shadow-[0_1px_0_rgba(0,0,0,0.03)]"
      data-runtime-ui-slot={card.id}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md',
            readToneContainerClassName(card.tone),
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
              {card.label}
            </h3>
            <span
              className={cn(
                'shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] font-medium tabular-nums',
                readTonePillClassName(card.tone),
              )}
            >
              {card.summary}
            </span>
          </div>
          {(card.meta || surfaces) && (
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              {card.meta ?? surfaces}
            </p>
          )}
          {card.progress !== null && <Progress value={card.progress} className="mt-1.5 h-1" />}
          {card.lines.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {card.lines.map(line => (
                <KeyValueLine key={`${card.id}:${line.label}`} line={line} />
              ))}
            </div>
          )}
          {card.state?.kind === 'crew' && <CrewSlotDetails state={card.state} />}
        </div>
      </div>
    </article>
  )
}

function KeyValueLine({ line }: { line: SlotCardLine }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-[10px]">
      <span className="shrink-0 text-muted-foreground">{line.label}</span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-right tabular-nums',
          readToneTextClassName(line.tone ?? 'neutral'),
        )}
      >
        {line.value}
      </span>
    </div>
  )
}

function CrewSlotDetails({ state }: { state: ChatRuntimeCrewUiSlotState }) {
  const agents = readCrewAgents(state)
  const collaborationModes = readCrewCollaborationModes(state)
  const calls = readCrewCalls(state)
  if (collaborationModes.length === 0 && agents.length === 0 && calls.length === 0) {
    return null
  }

  return (
    <div className="mt-2 space-y-2">
      {agents.length > 0 && (
        <CrewDetailSection label="Subagents">
          {agents.slice(0, 6).map((agent, index) => (
            <CrewAgentRow key={agent.threadId} agent={agent} index={index} />
          ))}
        </CrewDetailSection>
      )}
      {collaborationModes.length > 0 && (
        <CrewDetailSection label="Modes">
          {collaborationModes.slice(0, 4).map(mode => (
            <CrewModeRow key={mode.name} mode={mode} />
          ))}
        </CrewDetailSection>
      )}
      {calls.length > 0 && (
        <CrewDetailSection label="Calls">
          {calls.slice(0, 4).map(call => (
            <CrewCallRow key={call.id} call={call} />
          ))}
        </CrewDetailSection>
      )}
    </div>
  )
}

function CrewDetailSection({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function CrewAgentRow({ agent, index }: { agent: ChatRuntimeCrewAgentItem, index: number }) {
  const status = agent.status ? formatStatusLike(agent.status) : 'Unknown'
  const label = readCrewAgentLabel(agent)
  const details = readCrewAgentDetails(agent)
  return (
    <div className="min-w-0 text-[10px]">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'grid size-3 shrink-0 place-items-center rounded-[3px]',
            readCrewSwatchClassName(index),
          )}
        >
          <span className="size-1.5 rounded-[2px] bg-current opacity-80" />
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
        <span className={cn('shrink-0 tabular-nums', readCrewStatusTextClassName(agent.status))}>
          {status}
        </span>
      </div>
      {details && (
        <div className="mt-0.5 truncate pl-5 text-[9px] text-muted-foreground">{details}</div>
      )}
    </div>
  )
}

function CrewModeRow({ mode }: { mode: ChatRuntimeCrewCollaborationMode }) {
  const details = [mode.mode, mode.model, mode.reasoningEffort].filter(Boolean).join(' · ')
  return (
    <div className="flex min-w-0 items-center gap-2 text-[10px]">
      <span className="grid size-3 shrink-0 place-items-center rounded-[3px] bg-primary/15 text-primary">
        <SparklesIcon className="size-2.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">{mode.name}</span>
      {details && (
        <span className="max-w-[45%] shrink-0 truncate text-muted-foreground">{details}</span>
      )}
    </div>
  )
}

function CrewCallRow({ call }: { call: ChatRuntimeCrewCallItem }) {
  const receiverThreadIds = readCrewCallReceiverThreadIds(call)
  const detail = [
    receiverThreadIds.length > 0 ? `${receiverThreadIds.length} targets` : null,
    call.model,
    call.reasoningEffort,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="min-w-0 text-[10px]">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'shrink-0 tabular-nums',
            readToneTextClassName(readToolActivityTone(call.status)),
          )}
        >
          {formatStatusLike(call.status)}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">
          {formatStatusLike(call.tool)}
        </span>
        {detail && (
          <span className="max-w-[45%] shrink-0 truncate text-muted-foreground">{detail}</span>
        )}
      </div>
      {call.prompt && (
        <div className="mt-0.5 truncate pl-12 text-[9px] text-muted-foreground">{call.prompt}</div>
      )}
    </div>
  )
}

function readStateView(
  state: ChatRuntimeUiSlotState,
): Omit<SlotCardModel, 'id' | 'group' | 'label' | 'description' | 'icon' | 'slot' | 'state'> {
  switch (state.kind) {
    case 'status':
      return {
        tone:
          state.status === 'active'
            ? 'active'
            : state.status === 'systemError'
              ? 'error'
              : 'neutral',
        summary: formatStatusLike(state.status),
        meta: state.activeFlags.length > 0 ? state.activeFlags.join(', ') : 'No active flags',
        progress: null,
        lines: [{ label: 'Updated', value: formatRelativeTimestamp(state.updatedAt) }],
      }
    case 'model':
      return {
        tone: state.modelId ? 'neutral' : 'muted',
        summary: state.modelLabel ?? state.modelId ?? 'None',
        meta: state.modelProvider ?? 'Provider unknown',
        progress: null,
        lines: [
          { label: 'Tier', value: state.serviceTier ?? 'default' },
          {
            label: 'Images',
            value: state.supportsImages === null ? 'unknown' : state.supportsImages ? 'yes' : 'no',
          },
          {
            label: 'Web',
            value:
              state.supportsWebSearch === null ? 'unknown' : state.supportsWebSearch ? 'yes' : 'no',
          },
          {
            label: 'Namespace tools',
            value:
              state.supportsNamespaceTools === null
                ? 'unknown'
                : state.supportsNamespaceTools
                  ? 'yes'
                  : 'no',
          },
        ],
      }
    case 'reasoning':
      return {
        tone: state.effort ? 'neutral' : 'muted',
        summary: state.effort ?? 'Default',
        meta: state.summary ?? `${state.supportedEfforts.length} supported efforts`,
        progress: null,
        lines: [
          {
            label: 'Supported',
            value: state.supportedEfforts.map(effort => effort.id).join(', ') || 'unknown',
          },
        ],
      }
    case 'toolActivity':
      return {
        tone: state.failedCount > 0 ? 'error' : state.activeCount > 0 ? 'active' : 'neutral',
        summary: `${state.activeCount} active`,
        meta: `${state.completedCount} completed / ${state.failedCount} failed`,
        progress: null,
        lines: state.recentItems.slice(0, 4).map(item => ({
          label: formatStatusLike(item.status),
          value: item.label,
          tone: readToolActivityTone(item.status),
        })),
      }
    case 'mcp':
      return {
        tone: state.failedCount > 0 ? 'error' : state.readyCount > 0 ? 'success' : 'neutral',
        summary: `${state.readyCount}/${state.serverCount} ready`,
        meta: state.recentProgress ?? `${state.needsLoginCount} need login`,
        progress:
          state.serverCount > 0 ? clampPercent((state.readyCount / state.serverCount) * 100) : null,
        lines: state.servers.slice(0, 4).map(server => ({
          label: formatStatusLike(server.status),
          value: `${server.name} · ${server.toolCount} tools`,
          tone: readMcpServerTone(server.status),
        })),
      }
    case 'diff':
      return {
        tone: state.hasDiff ? 'active' : 'muted',
        summary: `${state.fileCount} files`,
        meta: `+${state.addedLines} -${state.removedLines}`,
        progress: null,
        lines: [{ label: 'Updated', value: formatRelativeTimestamp(state.updatedAt) }],
      }
    case 'terminal':
      return {
        tone: state.failedCount > 0 ? 'error' : state.activeCount > 0 ? 'active' : 'neutral',
        summary: `${state.activeCount} active`,
        meta: state.lastCommand ?? 'No command',
        progress: null,
        lines: [
          { label: 'Completed', value: String(state.completedCount) },
          {
            label: 'Failed',
            value: String(state.failedCount),
            tone: state.failedCount > 0 ? 'error' : 'neutral',
          },
          { label: 'Output', value: state.lastOutputPreview ?? 'none' },
        ],
      }
    case 'approvals':
      return {
        tone: state.deniedCount > 0 ? 'error' : state.pendingCount > 0 ? 'warning' : 'neutral',
        summary: `${state.pendingCount} pending`,
        meta: `${state.approvedCount} approved / ${state.deniedCount} denied`,
        progress: null,
        lines: state.recentItems.slice(0, 4).map(item => ({
          label: formatStatusLike(item.status),
          value: item.label,
          tone: readApprovalTone(item.status),
        })),
      }
    case 'alert':
      return {
        tone: state.errorCount > 0 ? 'error' : state.warningCount > 0 ? 'warning' : 'neutral',
        summary: `${state.warningCount + state.errorCount}`,
        meta: `${state.warningCount} warnings / ${state.errorCount} errors`,
        progress: null,
        lines: state.recentItems.slice(0, 4).map(item => ({
          label: formatStatusLike(item.severity),
          value: item.message,
          tone:
            item.severity === 'error'
              ? 'error'
              : item.severity === 'warning'
                ? 'warning'
                : 'neutral',
        })),
      }
    case 'filesystem':
      return {
        tone: state.changedPathCount > 0 ? 'active' : 'muted',
        summary: `${state.changedPathCount} paths`,
        meta: state.recentPaths[0] ?? 'No file activity',
        progress: null,
        lines: state.recentPaths.slice(0, 4).map(path => ({ label: 'Path', value: path })),
      }
    case 'skills':
      return {
        tone: state.errorCount > 0 ? 'error' : state.enabledCount > 0 ? 'success' : 'muted',
        summary: `${state.enabledCount} enabled`,
        meta: `${state.disabledCount} disabled / ${state.errorCount} errors`,
        progress: null,
        lines: state.roots.slice(0, 4).map(root => ({ label: 'Root', value: root })),
      }
    case 'plugin':
      return {
        tone: state.errorCount > 0 ? 'error' : state.enabledCount > 0 ? 'success' : 'muted',
        summary: `${state.enabledCount} enabled`,
        meta: `${state.installedCount} installed / ${state.appCount} apps`,
        progress: null,
        lines: [
          { label: 'Marketplace', value: String(state.marketplaceCount) },
          {
            label: 'Errors',
            value: String(state.errorCount),
            tone: state.errorCount > 0 ? 'error' : 'neutral',
          },
        ],
      }
    case 'search':
      return {
        tone: state.fuzzySessionActive
          ? 'active'
          : state.recentResultCount > 0
            ? 'neutral'
            : 'muted',
        summary: state.fuzzySessionActive ? 'Active' : `${state.recentResultCount} results`,
        meta: state.recentQuery ?? 'No recent query',
        progress: null,
        lines: [{ label: 'Updated', value: formatRelativeTimestamp(state.updatedAt) }],
      }
    case 'crew':
      return {
        tone: state.failedCount > 0 ? 'error' : state.activeCount > 0 ? 'active' : 'neutral',
        summary: `${state.activeCount} active`,
        meta: `${state.collaborationModeCount} modes`,
        progress: null,
        lines: state.recentItems.slice(0, 4).map(item => ({
          label: formatStatusLike(item.status),
          value: item.label,
          tone: readToolActivityTone(item.status),
        })),
      }
    case 'usage':
      return {
        tone: state.rateLimitReachedType
          ? 'error'
          : state.usedPercent !== null && state.usedPercent > 80
            ? 'warning'
            : 'neutral',
        summary: state.usedPercent === null ? 'unknown' : `${Math.round(state.usedPercent)}%`,
        meta: state.rateLimitReachedType ?? state.planType ?? 'Usage available',
        progress: state.usedPercent,
        lines: [
          {
            label: 'Secondary',
            value:
              state.secondaryUsedPercent === null
                ? 'unknown'
                : `${Math.round(state.secondaryUsedPercent)}%`,
          },
          {
            label: 'Credits',
            value:
              state.creditsBalance
              ?? (state.hasCredits === null ? 'unknown' : state.hasCredits ? 'yes' : 'no'),
          },
        ],
      }
    case 'config':
      return {
        tone: 'neutral',
        summary: state.sandboxMode ?? 'Config',
        meta: state.approvalPolicy ?? state.modelId ?? 'No config snapshot',
        progress: null,
        lines: [
          { label: 'Model', value: state.modelId ?? 'default' },
          {
            label: 'Approval modes',
            value:
              state.allowedApprovalPolicyCount === null
                ? 'unknown'
                : String(state.allowedApprovalPolicyCount),
          },
          {
            label: 'Sandbox modes',
            value:
              state.allowedSandboxModeCount === null
                ? 'unknown'
                : String(state.allowedSandboxModeCount),
          },
          {
            label: 'Requirements',
            value:
              state.featureRequirementCount === null
                ? 'unknown'
                : String(state.featureRequirementCount),
          },
        ],
      }
    case 'userInput':
      return {
        tone: 'warning',
        summary: state.questionCount === 1 ? '1 question' : `${state.questionCount} questions`,
        meta: state.questions[0]?.question ?? state.providerMethod,
        progress: null,
        lines: state.questions.slice(0, 4).map(question => ({
          label: question.header || 'Question',
          value: question.question,
          tone: 'warning',
        })),
      }
    default:
      return {
        tone: 'neutral',
        summary: 'Ready',
        meta: null,
        progress: null,
        lines: [],
      }
  }
}

function PanelHeading({ icon: Icon, label }: { icon: SlotIconComponent, label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

function readGroupIcon(group: SlotGroupKey) {
  switch (group) {
    case 'environment':
      return Settings2Icon
    case 'activity':
      return ActivityIcon
    case 'available':
    default:
      return SparklesIcon
  }
}

function readSlotIcon(iconKey?: ChatRuntimeUiSlotIconKey, kind?: ChatRuntimeUiSlotState['kind']) {
  switch (iconKey ?? kind) {
    case 'alert':
      return AlertTriangleIcon
    case 'approvals':
      return KeyRoundIcon
    case 'code-review':
      return GitPullRequestIcon
    case 'config':
      return Settings2Icon
    case 'crew':
      return BotIcon
    case 'diff':
      return FileDiffIcon
    case 'feedback':
      return SparklesIcon
    case 'filesystem':
      return FolderTreeIcon
    case 'ide-context':
      return Code2Icon
    case 'mcp':
      return ServerIcon
    case 'model':
      return CpuIcon
    case 'personality':
      return SparklesIcon
    case 'plugin':
      return Plugin2Line
    case 'progress':
      return ListChecksIcon
    case 'reasoning':
      return ZapIcon
    case 'search':
      return SearchIcon
    case 'side-chat':
      return BotIcon
    case 'skills':
      return PackageIcon
    case 'status':
      return ActivityIcon
    case 'terminal':
      return TerminalIcon
    case 'tool-activity':
    case 'toolActivity':
      return WrenchIcon
    case 'usage':
      return HardDriveIcon
    case 'user-input':
    case 'userInput':
      return HelpCircleIcon
    default:
      return CircleIcon
  }
}

function readFallbackStateLabel(kind: ChatRuntimeUiSlotState['kind']): string {
  switch (kind) {
    case 'toolActivity':
      return 'Tool activity'
    default:
      return formatStatusLike(kind)
  }
}

function readCardOrder(card: SlotCardModel): number {
  return card.state ? STATE_ORDER[card.state.kind] : 1_000
}

function readToolActivityTone(status: ChatRuntimeToolActivityStatus): SlotTone {
  switch (status) {
    case 'failed':
      return 'error'
    case 'running':
      return 'active'
    case 'completed':
    default:
      return 'success'
  }
}

function readMcpServerTone(status: ChatRuntimeMcpServerStatus): SlotTone {
  switch (status) {
    case 'ready':
      return 'success'
    case 'failed':
    case 'cancelled':
      return 'error'
    case 'starting':
      return 'active'
    case 'unknown':
    default:
      return 'muted'
  }
}

function readApprovalTone(status: ChatRuntimeApprovalStatus): SlotTone {
  switch (status) {
    case 'approved':
      return 'success'
    case 'denied':
    case 'timedOut':
    case 'aborted':
      return 'error'
    case 'pending':
    default:
      return 'warning'
  }
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

function readCrewCollaborationModes(state: ChatRuntimeCrewUiSlotState) {
  return Array.isArray(state.collaborationModes) ? state.collaborationModes : []
}

function readCrewCalls(state: ChatRuntimeCrewUiSlotState | null) {
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

function readCrewAgentDetails(agent: ChatRuntimeCrewAgentItem): string | null {
  return (
    [
      agent.agentRole,
      agent.name && agent.name !== agent.agentNickname ? agent.name : null,
      agent.modelProvider,
    ]
      .filter(Boolean)
      .join(' · ') || null
  )
}

function readCrewSwatchClassName(index: number): string {
  const classes = [
    'bg-amber-400/15 text-amber-400',
    'bg-sky-400/15 text-sky-400',
    'bg-violet-400/15 text-violet-400',
    'bg-rose-400/15 text-rose-400',
    'bg-orange-400/15 text-orange-400',
    'bg-emerald-400/15 text-emerald-400',
  ]
  return classes[index % classes.length] ?? classes[0]
}

function readCrewStatusTextClassName(status: string | null): string {
  switch (status) {
    case 'running':
    case 'pendingInit':
      return readToneTextClassName('active')
    case 'completed':
    case 'shutdown':
      return readToneTextClassName('success')
    case 'errored':
    case 'notFound':
      return readToneTextClassName('error')
    case 'interrupted':
      return readToneTextClassName('warning')
    default:
      return readToneTextClassName('muted')
  }
}

function readToneContainerClassName(tone: SlotTone): string {
  switch (tone) {
    case 'active':
      return 'bg-primary/10 text-primary'
    case 'success':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'warning':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    case 'error':
      return 'bg-destructive/10 text-destructive'
    case 'muted':
      return 'bg-background/60 text-muted-foreground'
    case 'neutral':
    default:
      return 'bg-background/80 text-foreground'
  }
}

function readTonePillClassName(tone: SlotTone): string {
  switch (tone) {
    case 'active':
      return 'bg-primary/10 text-primary'
    case 'success':
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    case 'warning':
      return 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    case 'error':
      return 'bg-destructive/10 text-destructive'
    case 'muted':
      return 'bg-background/60 text-muted-foreground'
    case 'neutral':
    default:
      return 'bg-background/80 text-muted-foreground'
  }
}

function readToneTextClassName(tone: SlotTone): string {
  switch (tone) {
    case 'active':
      return 'text-primary'
    case 'success':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'warning':
      return 'text-amber-600 dark:text-amber-400'
    case 'error':
      return 'text-destructive'
    case 'muted':
      return 'text-muted-foreground'
    case 'neutral':
    default:
      return 'text-foreground'
  }
}

function formatStatusLike(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function formatThreadId(threadId: string): string {
  if (threadId.length <= 18) {
    return threadId
  }
  return `${threadId.slice(0, 8)}...${threadId.slice(-4)}`
}

function formatSurfaces(surfaces: ChatRuntimeUiSlotSurface[]): string {
  return surfaces.map(surface => SURFACE_LABELS[surface]).join(' / ')
}

function formatRelativeTimestamp(timestamp: number): string {
  const ageSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000))
  if (ageSeconds < 60) {
    return 'now'
  }
  if (ageSeconds < 3600) {
    return `${Math.floor(ageSeconds / 60)}m ago`
  }
  if (ageSeconds < 86_400) {
    return `${Math.floor(ageSeconds / 3600)}h ago`
  }
  return `${Math.floor(ageSeconds / 86_400)}d ago`
}
