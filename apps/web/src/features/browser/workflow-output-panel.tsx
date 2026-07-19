import { StaticRender } from '@cradle/streamdown'
import {
  ArrowRightLine as ChevronRightIcon,
  CloseCircleLine as XCircleIcon,
  CodeLine as CodeIcon,
  LoadingLine as LoaderIcon,
} from '@mingcute/react'
import { useEffect, useState } from 'react'

import { kanbanCategoryColors, StatusIcon } from '~/components/ui/status-tag'
import { useWorkflowRuntime } from '~/features/chat/workflow/use-workflow-runtime'
import { cn } from '~/lib/cn'
import type {
  BrowserWorkflowRuntimeAgent,
  BrowserWorkflowTab,
} from '~/store/browser-panel'

// Compact run view: a centered document column where the agent list doubles as
// a waterfall timeline (GitHub Actions / trace-viewer style) — every row's bar
// is positioned on the same time axis, so parallelism and stragglers are
// visible at a glance instead of hidden behind per-row numbers.

const WORKFLOW_STATUS_META: Record<string, { label: string, className: string }> = {
  running: { label: 'Running', className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  completed: { label: 'Completed', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  failed: { label: 'Failed', className: 'bg-destructive/10 text-destructive' },
  stopped: { label: 'Stopped', className: 'bg-muted text-muted-foreground' },
}

export function WorkflowOutputPanel({ tab }: { tab: BrowserWorkflowTab }) {
  const runtime = useWorkflowRuntime(tab.sessionId, tab.toolCallId, tab.surface.runtime)
  const workflowStatus = runtime?.workflow.status ?? null
  const isRunning = workflowStatus === 'running' || workflowStatus === null
  const now = useNow(isRunning)
  const phases = runtime?.phases ?? tab.surface.phases.map((phase, index) => ({
    index: index + 1,
    title: phase.name,
    detail: phase.description,
    status: 'pending' as const,
    agentCount: 0,
    completedAgentCount: 0,
    runningAgentCount: 0,
    failedAgentCount: 0,
  }))
  const [selectedPhaseIndex, setSelectedPhaseIndex] = useState<number | null>(null)
  const selectedPhase = phases.find(phase => phase.index === selectedPhaseIndex)
    ?? runtime?.currentPhase
    ?? phases[0]
    ?? null
  const agents = runtime?.agents ?? []
  const visibleAgents = selectedPhase
    ? agents.filter(agent => agent.phaseIndex === selectedPhase.index)
    : agents
  const completedCount = agents.filter(agent => agent.status === 'completed').length
  const progress = agents.length > 0 ? (completedCount / agents.length) * 100 : 0
  const elapsed = runtime ? (runtime.workflow.durationMs ?? now - runtime.workflow.startedAt) : null
  const statusMeta = WORKFLOW_STATUS_META[workflowStatus ?? 'running'] ?? WORKFLOW_STATUS_META.running
  const resultMarkdown = toResultMarkdown(runtime?.workflow.result)
  const timeline = buildTimelineWindow(visibleAgents, runtime?.workflow.startedAt ?? null, now)

  return (
    <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background" data-testid="workflow-output-panel">
      <div className="flex h-9 shrink-0 items-center justify-end gap-2 border-b border-border/50 px-3">
        <p className="text-[11px] tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">
{completedCount}
/
{agents.length || '—'}
          </span>
{' '}
agents
{elapsed !== null && (
<>
{' '}
·
{formatDuration(elapsed)}
</>
)}
        </p>
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', statusMeta.className)}>
          {workflowStatus === 'running' && <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />}
          {statusMeta.label}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 pb-10 pt-4">
          <header>
            <h1 className="truncate text-[15px] font-semibold leading-6 tracking-tight text-foreground">
              {runtime?.workflow.name ?? tab.surface.workflowName ?? tab.title}
            </h1>
            <p className="mt-0.5 truncate text-[12px] leading-5 text-muted-foreground">
              {runtime?.workflow.description ?? tab.surface.description ?? 'Workflow execution'}
            </p>
            <div className="mt-2.5 flex items-center gap-2.5">
              <div
                className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={Math.round(progress)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={cn(
                    'h-full rounded-full transition-[width] duration-300',
                    workflowStatus === 'failed' ? 'bg-destructive' : 'bg-primary',
                  )}
                  style={{ width: `${Math.max(progress, workflowStatus === 'running' ? 4 : 0)}%` }}
                />
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {completedCount}
/
{agents.length || '—'}
              </span>
            </div>

            {phases.length > 0 && (
              <ol className="mt-3 flex min-w-0 items-center gap-1 overflow-x-auto text-[11px]">
                {phases.map((phase, index) => (
                  <li key={phase.index} className="flex shrink-0 items-center gap-1" title={phase.detail ?? undefined}>
                    {index > 0 && <ChevronRightIcon className="size-3 text-muted-foreground/50" aria-hidden="true" />}
                    <button
                      type="button"
                      className={cn(
                        'flex items-center gap-1 rounded-md py-0.5 pl-1 pr-1.5 transition-colors',
                        selectedPhase?.index === phase.index
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted/50 text-foreground/80 hover:bg-muted',
                      )}
                      onClick={() => setSelectedPhaseIndex(phase.index)}
                    >
                      <span className={cn(
                        'grid size-3.5 place-items-center rounded-full text-[9px] font-medium tabular-nums shadow-[var(--shadow-inset-ring)]',
                        phase.status === 'running' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground',
                      )}
                      >
                        {phase.index}
                      </span>
                      <span className="whitespace-nowrap">{phase.title}</span>
                      {phase.agentCount > 0 && (
                        <span className="tabular-nums text-muted-foreground">
                          {phase.completedAgentCount}
/
{phase.agentCount}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </header>

          <section className="mt-4">
            {visibleAgents.length === 0
? (
              <div className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground/70">
                <LoaderIcon className="size-3.5 animate-spin" aria-hidden="true" />
                {agents.length === 0 ? 'Waiting for agents to start…' : 'No agents in this phase'}
              </div>
            )
: (
              <div className="divide-y divide-border/40">
                {visibleAgents.map(agent => (
                  <WorkflowAgentRow key={agent.id} agent={agent} now={now} timeline={timeline} />
                ))}
              </div>
            )}
          </section>

          {resultMarkdown !== null && (
            <section className="mt-5">
              <h2 className="mb-1.5 text-[12px] font-semibold text-foreground/80">Result</h2>
              <div className="streamdown-root rounded-lg bg-muted/40 p-2.5 text-[12.5px] leading-relaxed">
                <StaticRender content={resultMarkdown} />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

const AGENT_STATUS_ICON: Record<string, { value: string, color: string }> = {
  pending: { value: 'unstarted', color: kanbanCategoryColors.unstarted },
  running: { value: 'started', color: kanbanCategoryColors.started },
  completed: { value: 'completed', color: kanbanCategoryColors.completed },
}

const AGENT_BAR_CLASS: Record<string, string> = {
  pending: 'bg-muted-foreground/30',
  running: 'bg-blue-500 animate-pulse',
  completed: 'bg-emerald-500/70',
  failed: 'bg-destructive',
}

interface TimelineWindow {
  start: number
  end: number
}

function WorkflowAgentRow({ agent, now, timeline }: {
  agent: BrowserWorkflowRuntimeAgent
  now: number
  timeline: TimelineWindow | null
}) {
  const running = agent.status === 'running'
  const duration = agent.startedAt !== null
    ? (agent.completedAt ?? now) - agent.startedAt
    : null
  const statusIcon = AGENT_STATUS_ICON[agent.status]

  const bar = timeline && agent.startedAt !== null
    ? {
        left: ((agent.startedAt - timeline.start) / (timeline.end - timeline.start)) * 100,
        width: Math.max((((agent.completedAt ?? now) - agent.startedAt) / (timeline.end - timeline.start)) * 100, 1.5),
      }
    : null

  return (
    <div className="flex min-h-7 items-center gap-2.5 py-1">
      <span className="shrink-0">
        {agent.status === 'failed'
          ? <XCircleIcon className="size-3.5 text-destructive" aria-label="Failed" />
          : statusIcon && <StatusIcon value={statusIcon.value} color={statusIcon.color} size={12} animated={running} />}
      </span>

      <span className="flex w-56 min-w-0 shrink-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-[12px] text-foreground/80">{agent.label}</span>
        {agent.model && (
          <span className="shrink-0 rounded bg-muted/60 px-1 py-0.5 text-[9.5px] text-foreground/70">
            {agent.model}
          </span>
        )}
      </span>

      <div className="relative h-1.5 min-w-0 flex-1 rounded-full bg-muted/40">
        {bar && (
          <div
            className={cn('absolute inset-y-0 rounded-full', AGENT_BAR_CLASS[agent.status] ?? AGENT_BAR_CLASS.pending)}
            style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
          />
        )}
      </div>

      {running && agent.lastToolName && (
        <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground">
          <CodeIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="max-w-24 truncate">{agent.lastToolName}</span>
        </span>
      )}

      <span className="shrink-0 text-right text-[10.5px] tabular-nums text-muted-foreground">
        {formatTokens(agent.totalTokens)}
{' '}
tok ·
{agent.toolUses}
{' '}
tools
      </span>
      <span className="w-12 shrink-0 text-right text-[10.5px] tabular-nums text-muted-foreground">
        {duration !== null ? formatDuration(duration) : '—'}
      </span>
    </div>
  )
}

function buildTimelineWindow(
  agents: BrowserWorkflowRuntimeAgent[],
  workflowStartedAt: number | null,
  now: number,
): TimelineWindow | null {
  const starts = agents.map(agent => agent.startedAt).filter((value): value is number => value !== null)
  const start = starts.length > 0 ? Math.min(...starts) : workflowStartedAt
  if (start === null) {
    return null
  }
  const ends = agents.map(agent => agent.completedAt ?? (agent.startedAt !== null ? now : 0))
  const end = Math.max(now, ...ends, start + 1000)
  return { start, end }
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) {
      setNow(Date.now())
      return
    }
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) {
    return '—'
  }
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`
}

function toResultMarkdown(result: unknown): string | null {
  if (result === null || result === undefined) {
    return null
  }
  if (typeof result === 'string') {
    return result
  }
  return `\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
}
