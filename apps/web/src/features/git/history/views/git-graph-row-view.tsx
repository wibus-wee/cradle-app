import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { getI18n } from '~/i18n/instance'
import { cn } from '~/lib/cn'

import type { LayoutCommit } from '../../shared/graph-layout'
import { LANE_COLORS } from '../../shared/graph-layout'
import { GitAuthorAvatarView } from './git-author-avatar-view'

export const GIT_GRAPH_ROW_HEIGHT = 27

const HALF_ROW_HEIGHT = GIT_GRAPH_ROW_HEIGHT / 2
const DOT_RADIUS = 4.5
const LANE_WIDTH = 16
const RE_HEAD_ARROW = /^HEAD -> /
const RE_TAG_PREFIX = /^tag: /

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]
}

function segmentPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) {
    return `M ${x1} ${y1} L ${x1} ${y2}`
  }
  return `M ${x1} ${y1} C ${x1} ${y2} ${x2} ${y1} ${x2} ${y2}`
}

function relativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 60) {
    return getI18n().t('git:graphRow.justNow')
  }
  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m`
  }
  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h`
  }
  if (diff < 2592000) {
    return `${Math.floor(diff / 86400)}d`
  }
  return `${Math.floor(diff / 2592000)}mo`
}

export interface GitGraphRowViewProps {
  commit: LayoutCommit
}

export function GitGraphRowView({ commit }: GitGraphRowViewProps) {
  const laneCount = Math.max(commit.visibleLaneCount, commit.lane + 1)
  const svgWidth = laneCount * LANE_WIDTH
  const centerX = commit.lane * LANE_WIDTH + LANE_WIDTH / 2
  const paths: React.ReactNode[] = []

  for (const line of commit.linesAbove) {
    const x1 = line.fromLane * LANE_WIDTH + LANE_WIDTH / 2
    const x2 = line.toLane * LANE_WIDTH + LANE_WIDTH / 2
    paths.push(
      <path
        key={`a-${line.fromLane}-${line.toLane}`}
        d={segmentPath(x1, 0, x2, HALF_ROW_HEIGHT)}
        stroke={laneColor(line.fromLane)}
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
      />,
    )
  }

  for (const line of commit.linesBelow) {
    const x1 = line.fromLane * LANE_WIDTH + LANE_WIDTH / 2
    const x2 = line.toLane * LANE_WIDTH + LANE_WIDTH / 2
    paths.push(
      <path
        key={`b-${line.fromLane}-${line.toLane}`}
        d={segmentPath(x1, HALF_ROW_HEIGHT, x2, GIT_GRAPH_ROW_HEIGHT)}
        stroke={laneColor(line.toLane)}
        strokeWidth={1.5}
        fill="none"
        strokeLinecap="round"
      />,
    )
  }

  const dotColor = laneColor(commit.lane)
  const isMerge = commit.parents.length > 1
  const isTag = commit.refs.some(reference => reference.startsWith('tag:'))
  const refBadges = commit.refs
    .flatMap((reference) => {
      const cleaned = reference.replace(RE_HEAD_ARROW, '').replace(RE_TAG_PREFIX, '')
      return !cleaned.startsWith('origin/') || commit.refs.length === 1
        ? [cleaned]
        : []
    })
    .slice(0, 3)
  const formattedDate = new Date(commit.timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div
      className="flex items-center transition-colors hover:bg-accent/30"
      style={{ height: GIT_GRAPH_ROW_HEIGHT }}
      data-testid="git-graph-row"
      data-commit-sha={commit.sha}
      data-commit-subject={commit.subject}
      data-commit-head={commit.refs.some(reference => reference.startsWith('HEAD -> ')) ? 'true' : 'false'}
    >
      <svg
        width={svgWidth}
        height={GIT_GRAPH_ROW_HEIGHT}
        className="shrink-0"
        aria-hidden="true"
      >
        {paths}
        <circle cx={centerX} cy={HALF_ROW_HEIGHT} r={DOT_RADIUS} fill={dotColor} />
        {isMerge && (
          <circle
            cx={centerX}
            cy={HALF_ROW_HEIGHT}
            r={DOT_RADIUS - 2}
            fill="var(--color-background)"
          />
        )}
      </svg>

      <Tooltip>
        <TooltipTrigger className="flex min-w-0 flex-1 items-center gap-1.5 pl-0.5 pr-1 text-left">
          {refBadges.map(reference => (
            <span
              key={reference}
              className={cn(
                'shrink-0 whitespace-nowrap rounded px-1 py-px font-mono text-[10px] leading-tight',
                isTag && 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
              )}
              style={!isTag ? { background: `${dotColor}26`, color: dotColor } : undefined}
            >
              {reference}
            </span>
          ))}
          <span className="truncate text-xs text-foreground/85">
            {commit.subject}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8} className="max-w-72 p-2.5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <GitAuthorAvatarView
                name={commit.authorName}
                email={commit.authorEmail}
                gravatarHash={commit.gravatarHash}
              />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium leading-tight">
                  {commit.authorName || commit.authorEmail}
                </p>
                {commit.authorEmail && commit.authorName && (
                  <p className="truncate text-[10px] text-muted-foreground">{commit.authorEmail}</p>
                )}
              </div>
            </div>
            <p className="text-xs leading-snug">{commit.subject}</p>
            <div className="flex flex-col gap-0.5">
              <p className="select-all font-mono text-[10px] text-muted-foreground">{commit.sha}</p>
              <p className="text-[10px] text-muted-foreground">{formattedDate}</p>
              {isMerge && (
                <p className="text-[10px] text-muted-foreground">
                  {getI18n().t('git:graphRow.mergedFrom', {
                    sha: commit.parents.slice(1).map(parent => parent.slice(0, 7)).join(', '),
                  })}
                </p>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>

      <div className="flex shrink-0 items-center gap-1.5 pr-2">
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {commit.shortSha}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">·</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {relativeTime(commit.timestamp)}
        </span>
      </div>
    </div>
  )
}
