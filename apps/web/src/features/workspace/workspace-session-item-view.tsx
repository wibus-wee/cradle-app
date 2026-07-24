import {
  AlertLine as CircleAlertIcon,
  GitPullRequestLine as WorkIcon,
  LoadingLine,
  More2Line as MoreHorizontalIcon,
  PinLine as PinIcon,
  SafeShieldLine as SafeShieldIcon,
  UserQuestionLine as UserQuestionIcon,
} from '@mingcute/react'
import type { DragEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { RuntimeIconDescriptor } from '~/components/common/provider-icons'
import { RuntimeIcon } from '~/components/common/provider-icons'
import {
  STATUS_ICON,
  STATUS_ICON_CLASS,
  statusKind,
} from '~/features/pull-requests/status-meta'
import type { WorkSummary } from '~/features/work/use-work'
import { cn } from '~/lib/cn'

import { SessionRenameInput } from './session-rename-input'
import type { WorkspaceSession } from './use-session'

export type WorkspaceSessionAttentionKind = 'userInput' | 'toolApproval'

export type WorkspaceSessionMenuAnchor
  = | HTMLElement
    | {
      getBoundingClientRect: () => DOMRect
    }

export interface WorkspaceSessionItemViewProps {
  session: WorkspaceSession
  work: WorkSummary | null
  active: boolean
  dimmed: boolean
  isStreaming: boolean
  attentionKind: WorkspaceSessionAttentionKind | null
  hasError: boolean
  isRenaming: boolean
  isRegeneratingTitle: boolean
  runtimeIcon: RuntimeIconDescriptor | undefined
  relativeTime: string
  draggable: boolean
  canOpenInNewWindow: boolean
  onOpen: () => void
  onPrepareOpen: () => void
  onPrefetch: () => void
  onPreview: (anchor: HTMLElement) => void
  onPreviewLeave: () => void
  onOpenInNewWindow: () => void
  onRenameCommit: (nextTitle: string) => Promise<void>
  onRenameCancel: () => void
  onOpenMenu: (anchor: WorkspaceSessionMenuAnchor) => void
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void
  onDrag?: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd?: (event: DragEvent<HTMLDivElement>) => void
}

function createPointMenuAnchor(
  clientX: number,
  clientY: number,
): WorkspaceSessionMenuAnchor {
  return {
    getBoundingClientRect: () => new DOMRect(clientX, clientY, 0, 0),
  }
}

export function WorkspaceSessionItemView({
  session,
  work,
  active,
  dimmed,
  isStreaming,
  attentionKind,
  hasError,
  isRenaming,
  isRegeneratingTitle,
  runtimeIcon,
  relativeTime,
  draggable,
  canOpenInNewWindow,
  onOpen,
  onPrepareOpen,
  onPrefetch,
  onPreview,
  onPreviewLeave,
  onOpenInNewWindow,
  onRenameCommit,
  onRenameCancel,
  onOpenMenu,
  onDragStart,
  onDrag,
  onDragEnd,
}: WorkspaceSessionItemViewProps) {
  const { t } = useTranslation('workspace')
  const { t: tWork } = useTranslation('work')
  const sessionTitle = session.title?.trim()
    || work?.title
    || t('session.fallbackTitle')
  const workActivityLabel = work
    ? tWork(`aside.activity.${work.activity}`)
    : null
  const workPullRequestLabel = work?.pullRequest
    ? work.pullRequest.merged
      ? tWork('sidebar.merged', { number: work.pullRequest.number })
      : work.pullRequest.isDraft
        ? tWork('sidebar.draft', { number: work.pullRequest.number })
        : tWork('sidebar.ready', { number: work.pullRequest.number })
    : null
  const workPullRequestStatus = work?.pullRequest
    ? statusKind(work.pullRequest)
    : null
  const WorkLeadingIcon = workPullRequestStatus
    ? STATUS_ICON[workPullRequestStatus]
    : WorkIcon
  const workLeadingIconClass = workPullRequestStatus
    ? STATUS_ICON_CLASS[workPullRequestStatus]
    : 'text-muted-foreground'
  const workActivityDotClass = work?.activity === 'blocked'
    ? 'bg-destructive'
    : work?.activity === 'waiting'
      ? 'bg-warning'
      : null
  const workStateLabel = work && workActivityLabel
    ? workPullRequestLabel
      ? work.activity === 'idle'
        ? workPullRequestLabel
        : `${workPullRequestLabel} · ${workActivityLabel}`
      : workActivityLabel
    : null

  const openButtonMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenMenu(event.currentTarget)
  }

  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenMenu(createPointMenuAnchor(event.clientX, event.clientY))
  }

  const openKeyboardMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== 'ContextMenu'
      && !(event.shiftKey && event.key === 'F10')
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    onOpenMenu(createPointMenuAnchor(
      rect.left + 24,
      rect.top + rect.height / 2,
    ))
  }

  const openNewWindow = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onOpenInNewWindow()
  }

  const preview = (event: PointerEvent<HTMLDivElement>) => {
    onPrefetch()
    onPreview(event.currentTarget)
  }

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      onContextMenu={isRenaming ? undefined : openContextMenu}
      onKeyDown={isRenaming ? undefined : openKeyboardMenu}
      onPointerEnter={isRenaming ? undefined : preview}
      onPointerLeave={isRenaming ? undefined : onPreviewLeave}
      className={cn(
        'group relative isolate flex min-w-0 w-full items-center rounded-lg text-left text-xs hover:bg-accent/50 [content-visibility:auto] [contain-intrinsic-block-size:30px]',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
      data-testid={`session-item-${session.id}`}
      data-session-pinned={session.pinned ? 'true' : 'false'}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 rounded-lg transition-colors',
          active ? 'bg-accent/80' : 'bg-transparent',
        )}
        aria-hidden="true"
        data-session-active={active ? 'true' : 'false'}
      />
      {isRenaming
        ? (
            <SessionRenameInput
              key={`${session.id}:${sessionTitle}`}
              initialTitle={sessionTitle}
              sessionId={session.id}
              pinned={Boolean(session.pinned)}
              trailingLabel={relativeTime}
              onCommit={onRenameCommit}
              onCancel={onRenameCancel}
            />
          )
        : (
            <>
              <button
                type="button"
                onClick={onOpen}
                onDoubleClick={canOpenInNewWindow
                  ? openNewWindow
                  : undefined}
                onFocus={onPrefetch}
                onPointerDown={onPrepareOpen}
                data-testid={`session-open-${session.id}`}
                className={cn(
                  'relative z-10 flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2.5 py-1.5 text-sidebar-foreground/80',
                  dimmed
                  && 'opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
                )}
              >
                {work
                  ? (
                      <span
                        className={cn(
                          'relative shrink-0',
                          workLeadingIconClass,
                          work.pullRequest && 'mr-1.5',
                        )}
                        title={workStateLabel ?? undefined}
                        data-testid={`work-status-${work.id}`}
                      >
                        <WorkLeadingIcon
                          className="size-3.5"
                          aria-hidden="true"
                        />
                        {workActivityDotClass && (
                          <span
                            className={cn(
                              'absolute -right-0.5 -top-0.5 size-1.5 rounded-full outline outline-2 outline-background',
                              workActivityDotClass,
                            )}
                            aria-hidden="true"
                          />
                        )}
                        {work.pullRequest && (
                          <span className="absolute -right-2 -bottom-0.5 min-w-3 rounded-full bg-gray-200 dark:bg-gray-800 px-0.5 text-center text-[7px] font-medium leading-2.5 text-muted-foreground tabular-nums">
                            #
                            {work.pullRequest.number}
                          </span>
                        )}
                        {workStateLabel && (
                          <span className="sr-only">{workStateLabel}</span>
                        )}
                      </span>
                    )
                  : hasError
                    ? (
                        <CircleAlertIcon
                          className="size-3.5 shrink-0 !text-destructive/80"
                          aria-label={t('session.aria.error')}
                          data-testid={`session-error-indicator-${session.id}`}
                        />
                      )
                    : (
                        <RuntimeIcon
                          icon={runtimeIcon}
                          className="size-3.5 shrink-0 text-muted-foreground/70"
                        />
                      )}
                {session.pinned
                  ? (
                      <PinIcon
                        className="size-3 shrink-0 !text-primary/60"
                        aria-label={t('session.aria.pinned')}
                        data-testid={`session-pin-indicator-${session.id}`}
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
                  data-testid={`session-title-${session.id}`}
                  data-regenerating={isRegeneratingTitle
                    ? 'true'
                    : undefined}
                >
                  {sessionTitle}
                </span>
                {session.unread && !isStreaming && !active
                  ? (
                      <span
                        className="shrink-0 size-1.5 rounded-full bg-primary"
                        aria-label={t('session.aria.newReply')}
                      />
                    )
                  : null}
                {isStreaming
                  ? attentionKind === 'userInput'
                    ? (
                        <span
                          className="grid size-3.5 shrink-0 place-items-center text-amber-500/85 [contain:layout_paint]"
                          aria-label={t(
                            'session.aria.waitingForUserInput',
                          )}
                          role="status"
                          data-testid={`session-waiting-user-input-indicator-${session.id}`}
                        >
                          <UserQuestionIcon
                            className="size-3.5"
                            aria-hidden="true"
                          />
                        </span>
                      )
                    : attentionKind === 'toolApproval'
                      ? (
                          <span
                            className="grid size-3.5 shrink-0 place-items-center text-amber-500/85 [contain:layout_paint]"
                            aria-label={t(
                              'session.aria.waitingForToolApproval',
                            )}
                            role="status"
                            data-testid={`session-waiting-tool-approval-indicator-${session.id}`}
                          >
                            <SafeShieldIcon
                              className="size-3.5"
                              aria-hidden="true"
                            />
                          </span>
                        )
                      : (
                          <span
                            className="grid size-3.5 shrink-0 animate-spin place-items-center text-muted-foreground/70 [contain:layout_paint] [will-change:transform] motion-reduce:animate-none"
                            aria-label={t('session.aria.running')}
                            role="status"
                            data-testid={`session-running-indicator-${session.id}`}
                          >
                            <LoadingLine
                              className="size-3.5"
                              aria-hidden="true"
                            />
                          </span>
                        )
                  : (
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                        {relativeTime}
                      </span>
                    )}
              </button>
              <div className="group/menu relative z-10 mr-0.5 size-6 shrink-0">
                <button
                  type="button"
                  className="absolute inset-0 grid place-items-center rounded-md text-muted-foreground/50 opacity-0 hover:bg-accent/80 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                  onClick={openButtonMenu}
                  aria-haspopup="menu"
                  aria-label={t('session.aria.menu')}
                  data-testid={`session-menu-trigger-${session.id}`}
                >
                  <MoreHorizontalIcon className="size-3" aria-hidden="true" />
                </button>
              </div>
            </>
          )}
    </div>
  )
}
