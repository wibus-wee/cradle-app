import {
  GitPullRequestLine as PullRequestIcon,
  More2Line as MoreIcon,
  PinLine as PinIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
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
  const pullRequestLabel = work.pullRequest
    ? work.pullRequest.merged
      ? t('sidebar.merged', { number: work.pullRequest.number })
      : work.pullRequest.isDraft
        ? t('sidebar.draft', { number: work.pullRequest.number })
        : t('sidebar.ready', { number: work.pullRequest.number })
    : t(`aside.activity.${work.activity}`)

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
                <PullRequestIcon className="size-3.5 shrink-0" aria-hidden="true" />
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
                <span className="shrink-0 text-[10px] text-muted-foreground/70">{pullRequestLabel}</span>
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
