import {
  GitPullRequestLine as PullRequestIcon,
  LoadingLine,
  More2Line as MoreIcon,
  PinLine as PinIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  STATUS_ICON,
  STATUS_ICON_CLASS,
  statusKind,
} from '~/features/pull-requests/status-meta'
import { SessionRenameInput } from '~/features/workspace/session-rename-input'
import type { WorkspaceSession } from '~/features/workspace/use-session'
import { cn } from '~/lib/cn'
import { useIsActiveSurfaceId } from '~/navigation/active-surface'
import { openWork } from '~/navigation/navigation-commands'
import { workSurfaceId } from '~/navigation/surface-identity'
import { useTitleRegenerationStore } from '~/store/title-regeneration'

import type { WorkSummary } from './use-work'

type WorkMenuAnchor
  = | HTMLElement
    | {
      getBoundingClientRect: () => DOMRect
    }

type WorkMenuRequest = {
  sessionId: string
  workId: string
  anchor: WorkMenuAnchor
  surface: 'button' | 'context'
}

function createPointMenuAnchor(clientX: number, clientY: number): WorkMenuAnchor {
  return {
    getBoundingClientRect: () => new DOMRect(clientX, clientY, 0, 0),
  }
}

function WorkRow({
  work,
  session,
  isRenaming,
  onRenameCommit,
  onRenameCancel,
  onOpenMenu,
}: {
  work: WorkSummary
  session: WorkspaceSession | null
  isRenaming: boolean
  onRenameCommit: (session: WorkspaceSession, nextTitle: string) => Promise<void>
  onRenameCancel: () => void
  onOpenMenu: (request: WorkMenuRequest) => void
}) {
  const { t } = useTranslation('work')
  const { t: tWorkspace } = useTranslation('workspace')
  const active = useIsActiveSurfaceId(workSurfaceId(work.id))
  const isRegeneratingTitle = useTitleRegenerationStore(state =>
    state.regeneratingSessionIds.has(work.primarySessionId))
  const title = session?.title?.trim() || work.title
  const activityLabel = t(`aside.activity.${work.activity}`)
  const isRunning = work.activity === 'running'
  // The trailing chip only carries the PR label when there *is* a PR.
  // Activity is conveyed by the leading status icon + corner dot (below),
  // mirroring the Pull Requests page's "icon color + dot" idiom - so we no
  // longer render a "运行中"/"空闲" text chip on the right.
  const pullRequestLabel = work.pullRequest
    ? work.pullRequest.merged
      ? t('sidebar.merged', { number: work.pullRequest.number })
      : work.pullRequest.isDraft
        ? t('sidebar.draft', { number: work.pullRequest.number })
        : t('sidebar.ready', { number: work.pullRequest.number })
    : undefined
  const prStatus = work.pullRequest ? statusKind(work.pullRequest) : null
  const LeadingIcon = prStatus ? STATUS_ICON[prStatus] : PullRequestIcon
  const leadingIconClass = prStatus ? STATUS_ICON_CLASS[prStatus] : 'text-muted-foreground'
  // Corner dot encodes agent activity the way the PR page's dot encodes CI
  // state. Running is carried by the trailing spinner instead of a dot, so the
  // two never compete; idle shows nothing at all.
  const activityDotClass
    = work.activity === 'blocked'
      ? 'bg-destructive'
      : work.activity === 'waiting'
        ? 'bg-warning'
        : null
  const stateLabel = pullRequestLabel
    ? work.activity === 'idle'
      ? pullRequestLabel
      : `${pullRequestLabel} · ${activityLabel}`
    : activityLabel

  const openMenu = (anchor: WorkMenuAnchor, surface: 'button' | 'context') => {
    onOpenMenu({
      sessionId: work.primarySessionId,
      workId: work.id,
      anchor,
      surface,
    })
  }

  return (
    <div
      className="group relative isolate flex min-w-0 w-full items-center rounded-lg text-left text-xs hover:bg-accent/50"
      data-testid={`work-sidebar-row-${work.id}`}
      onContextMenu={isRenaming
        ? undefined
        : (event) => {
            event.preventDefault()
            event.stopPropagation()
            openMenu(createPointMenuAnchor(event.clientX, event.clientY), 'context')
          }}
      onKeyDown={isRenaming
        ? undefined
        : (event) => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
              return
            }
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            openMenu(createPointMenuAnchor(rect.left + 24, rect.top + rect.height / 2), 'context')
          }}
    >
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-lg transition-colors',
          active ? 'bg-accent/80' : 'bg-transparent',
        )}
      />
      {isRenaming && session
        ? (
            <SessionRenameInput
              initialTitle={title}
              sessionId={session.id}
              pinned={Boolean(session.pinned)}
              trailingLabel={pullRequestLabel}
              onCommit={nextTitle => onRenameCommit(session, nextTitle)}
              onCancel={onRenameCancel}
            />
          )
        : (
            <>
              <button
                type="button"
                onClick={() => openWork(work.id)}
                className="relative z-10 flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2.5 py-1.5 text-sidebar-foreground/80"
              >
                <span
                  className={cn('relative shrink-0', leadingIconClass)}
                  title={stateLabel}
                  data-testid={`work-status-${work.id}`}
                >
                  <LeadingIcon className="size-3.5" aria-hidden="true" />
                  {activityDotClass && (
                    <span
                      className={cn(
                        'absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full outline outline-2 outline-background',
                        activityDotClass,
                      )}
                      aria-hidden="true"
                    />
                  )}
                  <span className="sr-only">{stateLabel}</span>
                </span>
                {session?.pinned
                  ? (
                      <PinIcon
                        className="size-3 shrink-0 !text-primary/60"
                        aria-label={tWorkspace('session.aria.pinned')}
                      />
                    )
                  : null}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-left',
                    isRegeneratingTitle && [
                      'text-sidebar-foreground',
                      '[mask-image:linear-gradient(90deg,rgba(0,0,0,0.35)_0%,black_36%,black_64%,rgba(0,0,0,0.35)_100%)] [mask-size:220%_100%]',
                      '[-webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0.35)_0%,black_36%,black_64%,rgba(0,0,0,0.35)_100%)] [-webkit-mask-size:220%_100%]',
                      'animate-[shimmer_1.6s_linear_infinite]',
                    ],
                  )}
                  data-testid={`work-title-${work.id}`}
                >
                  {title}
                </span>
                {isRunning
                  ? (
                      <span
                        className="grid size-3.5 shrink-0 animate-spin place-items-center text-muted-foreground/70 [contain:layout_paint] [will-change:transform] motion-reduce:animate-none"
                        role="status"
                        aria-label={activityLabel}
                        data-testid={`work-running-indicator-${work.id}`}
                      >
                        <LoadingLine className="size-3.5" aria-hidden="true" />
                      </span>
                    )
                  : pullRequestLabel
                    ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground/70">
                          {pullRequestLabel}
                        </span>
                      )
                    : null}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="relative z-10 mr-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-haspopup="menu"
                aria-label={tWorkspace('session.aria.menu')}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  openMenu(event.currentTarget, 'button')
                }}
              >
                <MoreIcon />
              </Button>
            </>
          )}
    </div>
  )
}

export function WorkSidebarSection({
  works,
  sessionsById,
  renamingSessionId,
  onRenameCommit,
  onRenameCancel,
  onOpenMenu,
}: {
  works: WorkSummary[]
  sessionsById: ReadonlyMap<string, WorkspaceSession>
  renamingSessionId: string | null
  onRenameCommit: (session: WorkspaceSession, nextTitle: string) => Promise<void>
  onRenameCancel: () => void
  onOpenMenu: (request: WorkMenuRequest) => void
}) {
  if (works.length === 0) {
    return null
  }
  return (
    <section className="ml-4.25 flex min-w-0 flex-col gap-0.5 border-l border-sidebar-border/50 pl-2 py-0.5" data-testid="work-sidebar-section">
      {works.map(work => (
        <WorkRow
          key={work.id}
          work={work}
          session={sessionsById.get(work.primarySessionId) ?? null}
          isRenaming={renamingSessionId === work.primarySessionId}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          onOpenMenu={onOpenMenu}
        />
      ))}
    </section>
  )
}
