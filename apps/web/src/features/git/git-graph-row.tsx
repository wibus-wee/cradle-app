import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { getI18n } from '~/i18n/instance'
import { cn } from '~/lib/cn'

import type { LayoutCommit } from './graph-layout'
import { LANE_COLORS } from './graph-layout'

// Must match VList itemSize in git-panel
export const ROW_HEIGHT = 27
const HALF = ROW_HEIGHT / 2
const DOT_RADIUS = 4.5
const LANE_WIDTH = 16

const RE_WHITESPACE = /\s+/
const RE_HEAD_ARROW = /^HEAD -> /
const RE_TAG_PREFIX = /^tag: /

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]
}

/** Cubic bezier path: departs vertically from (x1,y1), arrives vertically at (x2,y2). */
function segmentPath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) {
    return `M ${x1} ${y1} L ${x1} ${y2}`
  }
  // Control points: (x1,y2) and (x2,y1) give vertical tangents at start and end
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

function nameHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash * 31) + name.charCodeAt(i)) >>> 0
  }
  return hash % 360
}

const RE_GITHUB_NOREPLY = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/
const RE_GITHUB_NOREPLY_OLD = /^([^@]+)@users\.noreply\.github\.com$/

function emailToAvatarUrl(email: string, gravatarHash: string): string | null {
  const newer = RE_GITHUB_NOREPLY.exec(email)
  if (newer) {
    return `https://avatars.githubusercontent.com/u/${newer[1]}?v=4&s=32`
  }
  const older = RE_GITHUB_NOREPLY_OLD.exec(email)
  if (older) {
    return `https://github.com/${older[1]}.png?size=32`
  }
  if (gravatarHash) {
    return `https://www.gravatar.com/avatar/${gravatarHash}?s=32&d=identicon`
  }
  return null
}

function AuthorAvatar({ name, email, gravatarHash }: { name: string, email: string, gravatarHash: string }) {
  const words = name.trim().split(RE_WHITESPACE).filter(Boolean)
  const initials = words.length >= 2
    ? (words[0][0] ?? '') + (words.at(-1)![0] ?? '')
    : (words[0]?.[0] ?? name[0] ?? '?')
  const hue = nameHue(name || email)
  const bg = `hsl(${hue}, 45%, 48%)`
  const avatarUrl = emailToAvatarUrl(email, gravatarHash)

  return (
    <span
      className="relative flex shrink-0 size-6 items-center justify-center rounded-full text-[10px] font-bold leading-none text-white overflow-hidden"
      style={{ background: bg }}
      aria-label={name || email}
    >
      <span aria-hidden="true">{initials.toUpperCase()}</span>
      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          className="absolute inset-0 size-full rounded-full object-cover"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )}
    </span>
  )
}

interface GitGraphRowProps {
  commit: LayoutCommit
}

export const GitGraphRow = GitGraphRowInner

function GitGraphRowInner({ commit }: GitGraphRowProps) {
  const laneCount = Math.max(commit.visibleLaneCount, commit.lane + 1)
  const svgWidth = laneCount * LANE_WIDTH
  const cx = commit.lane * LANE_WIDTH + LANE_WIDTH / 2

  const svgPaths = (() => {
    const paths: React.ReactNode[] = []

    for (const line of commit.linesAbove) {
      const x1 = line.fromLane * LANE_WIDTH + LANE_WIDTH / 2
      const x2 = line.toLane * LANE_WIDTH + LANE_WIDTH / 2
      paths.push(
        <path
          key={`a-${line.fromLane}-${line.toLane}`}
          d={segmentPath(x1, 0, x2, HALF)}
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
          d={segmentPath(x1, HALF, x2, ROW_HEIGHT)}
          stroke={laneColor(line.toLane)}
          strokeWidth={1.5}
          fill="none"
          strokeLinecap="round"
        />,
      )
    }

    return paths
  })()

  const dotColor = laneColor(commit.lane)
  const isMerge = commit.parents.length > 1
  const isTag = commit.refs.some(r => r.startsWith('tag:'))

  const refBadges = commit.refs
    .flatMap((r) => {
      const cleaned = r.replace(RE_HEAD_ARROW, '').replace(RE_TAG_PREFIX, '')
      return !cleaned.startsWith('origin/') || commit.refs.length === 1 ? [cleaned] : []
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
      className="flex items-center hover:bg-accent/30 transition-colors"
      style={{ height: ROW_HEIGHT }}
      data-testid="git-graph-row"
      data-commit-sha={commit.sha}
      data-commit-subject={commit.subject}
      data-commit-head={commit.refs.some(ref => ref.startsWith('HEAD -> ')) ? 'true' : 'false'}
    >
      {/* Graph SVG — shrinks with lane count */}
      <svg
        width={svgWidth}
        height={ROW_HEIGHT}
        className="shrink-0"
        aria-hidden="true"
      >
        {svgPaths}
        <circle cx={cx} cy={HALF} r={DOT_RADIUS} fill={dotColor} />
        {isMerge && (
          <circle cx={cx} cy={HALF} r={DOT_RADIUS - 2} fill="var(--color-background)" />
        )}
      </svg>

      {/* Single-line commit info: [badges] message */}
      <Tooltip>
        <TooltipTrigger className="flex min-w-0 flex-1 items-center gap-1.5 pl-0.5 pr-1 text-left">
          {/* Ref badges — inline */}
          {refBadges.map(ref => (
            <span
              key={ref}
              className={cn(
                'shrink-0 rounded px-1 py-px font-mono text-[10px] leading-tight whitespace-nowrap',
                isTag && 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
              )}
              style={!isTag ? { background: `${dotColor}26`, color: dotColor } : undefined}
            >
              {ref}
            </span>
          ))}
          {/* Commit message */}
          <span className="truncate text-xs text-foreground/85">
            {commit.subject}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8} className="max-w-72 p-2.5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <AuthorAvatar name={commit.authorName} email={commit.authorEmail} gravatarHash={commit.gravatarHash} />
              <div className="min-w-0">
                <p className="text-xs font-medium leading-tight truncate">{commit.authorName || commit.authorEmail}</p>
                {commit.authorEmail && commit.authorName && (
                  <p className="text-[10px] text-muted-foreground truncate">{commit.authorEmail}</p>
                )}
              </div>
            </div>
            <p className="text-xs leading-snug">{commit.subject}</p>
            <div className="flex flex-col gap-0.5">
              <p className="font-mono text-[10px] text-muted-foreground select-all">{commit.sha}</p>
              <p className="text-[10px] text-muted-foreground">{formattedDate}</p>
              {isMerge && (
                <p className="text-[10px] text-muted-foreground">
                  {getI18n().t('git:graphRow.mergedFrom', { sha: commit.parents.slice(1).map(p => p.slice(0, 7)).join(', ') })}
                </p>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>

      {/* Right-aligned: sha · time */}
      <div className="flex shrink-0 items-center gap-1.5 pr-2">
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {commit.shortSha}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          ·
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {relativeTime(commit.timestamp)}
        </span>
      </div>
    </div>
  )
}
