import {
  CheckLine as CheckIcon,
  HashtagLine as HashIcon,
  HeartbeatLine as ActivityIcon,
  StopwatchLine as TimerIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'

import { getChatRunsByRunIdSnapshotOptions } from '~/api-gen/@tanstack/react-query.gen'
import type { GetChatRunsByRunIdSnapshotResponse } from '~/api-gen/types.gen'
import { Badge } from '~/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip'
import { formatShortDurationMs } from '~/lib/number-format'
import type { ChatRunDisplayMeta } from '~/store/chat'
import { chatSelectors } from '~/store/chat'

import { useChatRenderStore } from './chat-render-store'

type RunTimingMetrics = {
  ttfbMs: number | null
  ttftMs: number | null
  totalMs: number | null
}

type RunSnapshotEvent = GetChatRunsByRunIdSnapshotResponse['events'][number]

const TERMINAL_CHUNK_TYPES = new Set(['finish', 'abort', 'error'])
const NON_RESPONSE_SNAPSHOT_PHASES = new Set([
  'run_started',
  'stream_finished',
  'stream_failed',
  'run_finalized',
  'usage',
  'step_usage',
])

export function RunDebugCaption({ messageId }: { messageId: string }) {
  const meta = useChatRenderStore(chatSelectors.runDisplayMeta(messageId), (a, b) => a === b)
  const { data: runSnapshot } = useQuery({
    ...getChatRunsByRunIdSnapshotOptions({ path: { runId: meta?.runId ?? '' } }),
    enabled: Boolean(meta?.runId),
    refetchInterval: query => query.state.data?.status === 'running' ? 1000 : false,
  })
  if (!meta) {
    return null
  }

  const localTimings = readLocalRunTimings(meta)
  const snapshotTimings = runSnapshot ? readRunSnapshotTimings(runSnapshot) : null
  const ttfbMs = snapshotTimings ? snapshotTimings.ttfbMs : localTimings.ttfbMs
  const ttftMs = snapshotTimings ? snapshotTimings.ttftMs : localTimings.ttftMs
  const totalMs = snapshotTimings?.totalMs ?? localTimings.totalMs
  const shortRunId = meta.runId ? `${meta.runId.slice(0, 8)}\u2026` : 'pending'

  return (
    <TooltipProvider delayDuration={250}>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <Tooltip>
          <TooltipTrigger
            render={(
              <Badge
                variant="outline"
                className="h-5 max-w-full gap-1 border-border/50 bg-muted/25 px-1.5 font-mono font-normal text-[10px] text-muted-foreground tabular-nums"
              >
                <HashIcon className="size-3" aria-hidden="true" />
                <span className="truncate">{shortRunId}</span>
              </Badge>
            )}
          />
          <TooltipContent sideOffset={6}>
            {meta.runId ?? 'Run has not been assigned yet'}
          </TooltipContent>
        </Tooltip>
        <MetricBadge
          icon={<ActivityIcon className="size-3" aria-hidden="true" />}
          label="TTFB"
          value={ttfbMs}
        />
        <MetricBadge
          icon={<TimerIcon className="size-3" aria-hidden="true" />}
          label="TTFT"
          value={ttftMs}
        />
        {totalMs !== null && (
          <MetricBadge
            icon={<CheckIcon className="size-3" aria-hidden="true" />}
            label="Done"
            value={totalMs}
          />
        )}
      </div>
    </TooltipProvider>
  )
}

function readLocalRunTimings(meta: ChatRunDisplayMeta): RunTimingMetrics {
  return {
    ttfbMs: meta.firstEventAtMs === null ? null : Math.max(0, meta.firstEventAtMs - meta.requestStartedAtMs),
    ttftMs: meta.firstContentAtMs === null ? null : Math.max(0, meta.firstContentAtMs - meta.requestStartedAtMs),
    totalMs: meta.completedAtMs === null ? null : Math.max(0, meta.completedAtMs - meta.requestStartedAtMs),
  }
}

function readRunSnapshotTimings(snapshot: GetChatRunsByRunIdSnapshotResponse): RunTimingMetrics {
  const firstResponseEvent = snapshot.events.find(isResponseSnapshotEvent)
  const firstTextDeltaEvent = snapshot.events.find(event => event.phase === 'model_text_first_delta')
  return {
    ttfbMs: firstResponseEvent ? Math.max(0, firstResponseEvent.occurredAt - snapshot.startedAt) : null,
    ttftMs: firstTextDeltaEvent ? Math.max(0, firstTextDeltaEvent.occurredAt - snapshot.startedAt) : null,
    totalMs: snapshot.completedAt == null ? null : Math.max(0, snapshot.completedAt - snapshot.startedAt),
  }
}

function isResponseSnapshotEvent(event: RunSnapshotEvent): boolean {
  return Boolean(
    event.chunkType
    && !TERMINAL_CHUNK_TYPES.has(event.chunkType)
    && !NON_RESPONSE_SNAPSHOT_PHASES.has(event.phase),
  )
}

function MetricBadge({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number | null
}) {
  return (
    <Badge
      variant="ghost"
      className="h-5 gap-1 px-1.5 font-normal text-[10px] text-muted-foreground/80 tabular-nums"
    >
      {icon}
      <span>{label}</span>
      <span className="font-mono">
        {value === null ? '\u2026' : formatShortDurationMs(value).replaceAll(' ', '')}
      </span>
    </Badge>
  )
}
