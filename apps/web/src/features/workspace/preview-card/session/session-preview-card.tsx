import { useQuery } from '@tanstack/react-query'
import { m, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { chatMessageSnapshotQueryOptions } from '~/features/chat/api/messages'
import type { ChatSessionMessageRow } from '~/features/chat/session/use-chat-session-types'
import { cn } from '~/lib/cn'

import type { WorkspaceSession } from '../../use-session'
import type { PreviewCardPlacement } from '../preview-card-context'

const SESSION_PREVIEW_MESSAGE_LIMIT = 4
const SESSION_PREVIEW_GUTTER_PX = 8
const SESSION_PREVIEW_VIEWPORT_GUTTER_PX = 8
const SESSION_PREVIEW_WIDTH_PX = 320
const SESSION_PREVIEW_MAX_HEIGHT_PX = 384

interface SessionPreviewPosition {
  x: number
  y: number
}

interface SessionPreviewTarget {
  session: WorkspaceSession
  anchor: HTMLElement
}

function readSessionPreviewText(row: ChatSessionMessageRow): string {
  return row.preview.trim()
}

function getPreviewPosition(anchor: HTMLElement, previewHeight: number, placement: PreviewCardPlacement): SessionPreviewPosition {
  const rect = anchor.getBoundingClientRect()
  const maxX = window.innerWidth - SESSION_PREVIEW_WIDTH_PX - SESSION_PREVIEW_VIEWPORT_GUTTER_PX
  const maxY = window.innerHeight - previewHeight - SESSION_PREVIEW_VIEWPORT_GUTTER_PX

  if (placement === 'bottom') {
    return {
      x: Math.max(SESSION_PREVIEW_VIEWPORT_GUTTER_PX, Math.min(rect.left, maxX)),
      y: rect.bottom + SESSION_PREVIEW_GUTTER_PX,
    }
  }

  return {
    x: Math.min(rect.right + SESSION_PREVIEW_GUTTER_PX, maxX),
    y: Math.max(SESSION_PREVIEW_VIEWPORT_GUTTER_PX, Math.min(rect.top, maxY)),
  }
}

export function SessionPreviewCard({
  target,
  placement,
  open,
  onPointerEnter,
  onPointerLeave,
}: {
  target: SessionPreviewTarget
  placement: PreviewCardPlacement
  open: boolean
  onPointerEnter: () => void
  onPointerLeave: () => void
}) {
  const { t } = useTranslation('workspace')
  const [position, setPosition] = useState<SessionPreviewPosition | null>(null)
  const [previewElement, setPreviewElement] = useState<HTMLDivElement | null>(null)
  const [previewHeight, setPreviewHeight] = useState(SESSION_PREVIEW_MAX_HEIGHT_PX)
  const reduceMotion = useReducedMotion()
  const snapshotQuery = useQuery(chatMessageSnapshotQueryOptions(target.session.id))
  const rows = snapshotQuery.data?.rows as ChatSessionMessageRow[] | undefined
  const previewMessages = useMemo(() => {
    if (!rows) {
      return []
    }

    return rows
      .filter(row => !row.parentToolCallId)
      .map(row => ({
        id: row.messageId,
        role: row.role,
        text: readSessionPreviewText(row),
      }))
      .filter(message => message.text.length > 0)
      .slice(-SESSION_PREVIEW_MESSAGE_LIMIT)
  }, [rows])

  const updatePosition = useCallback(() => {
    setPosition(getPreviewPosition(target.anchor, previewHeight, placement))
  }, [previewHeight, target.anchor, placement])

  useLayoutEffect(() => {
    if (!previewElement) {
      return
    }

    const updatePreviewHeight = () => {
      setPreviewHeight(previewElement.getBoundingClientRect().height)
    }

    updatePreviewHeight()
    if (!window.ResizeObserver) {
      return
    }

    const observer = new ResizeObserver(updatePreviewHeight)
    observer.observe(previewElement)
    return () => observer.disconnect()
  }, [previewElement])

  useLayoutEffect(() => {
    updatePosition()
  }, [updatePosition])

  useEffect(() => {
    let frameId: number | null = null
    const schedulePositionUpdate = () => {
      if (frameId !== null) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        updatePosition()
      })
    }

    window.addEventListener('resize', schedulePositionUpdate)
    window.addEventListener('scroll', schedulePositionUpdate, true)

    return () => {
      window.removeEventListener('resize', schedulePositionUpdate)
      window.removeEventListener('scroll', schedulePositionUpdate, true)
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [updatePosition])

  if (!position) {
    return null
  }

  const sessionTitle = target.session.title ?? t('session.fallbackTitle')

  return createPortal(
    <m.div
      ref={setPreviewElement}
      initial={false}
      animate={{
        opacity: open ? 1 : 0,
        scale: open ? 1 : 0.98,
        x: position.x,
        y: position.y,
      }}
      transition={reduceMotion
        ? { duration: 0 }
        : {
            x: { type: 'spring', stiffness: 600, damping: 40 },
            y: { type: 'spring', stiffness: 600, damping: 40 },
            opacity: { duration: 0.12 },
            scale: { type: 'spring', stiffness: 600, damping: 40 },
          }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="fixed top-0 left-0 z-50 flex max-h-96 w-80 flex-col gap-3 overflow-hidden rounded-xl bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      data-testid={`session-preview-${target.session.id}`}
      style={{ pointerEvents: open ? 'auto' : 'none' }}
    >
      <p className="truncate text-[13px] font-medium text-foreground">{sessionTitle}</p>

      <div className="flex min-h-16 flex-col gap-2.5 overflow-hidden">
        {snapshotQuery.isPending
          ? (
              <div className="flex flex-col gap-2.5" aria-label={t('session.preview.loading')}>
                <div className="flex w-full justify-end">
                  <div className="h-9 w-3/5 animate-pulse rounded-lg rounded-br-sm bg-muted/70 motion-reduce:animate-none" />
                </div>
                <div className="flex w-full">
                  <div className="h-12 w-full animate-pulse rounded-lg bg-muted/50 motion-reduce:animate-none" />
                </div>
              </div>
            )
          : snapshotQuery.isError
            ? (
                <p className="py-3 text-[12px] leading-relaxed text-muted-foreground">
                  {t('session.preview.error')}
                </p>
              )
            : previewMessages.length === 0
              ? (
                  <p className="py-3 text-[12px] leading-relaxed text-muted-foreground">
                    {t('session.preview.empty')}
                  </p>
                )
              : previewMessages.map(message => (
                  <div
                    key={message.id}
                    className={cn(
                      'flex w-full gap-3',
                      message.role === 'user' && 'justify-end',
                    )}
                  >
                    <div
                      className={cn(
                        'min-w-0 rounded-lg text-[13px] leading-relaxed text-foreground',
                        message.role === 'user'
                          ? 'max-w-[85%] rounded-br-sm bg-muted px-3 py-2'
                          : 'w-full',
                      )}
                    >
                      <span className="sr-only">
                        {message.role === 'user'
                          ? t('session.preview.user')
                          : t('session.preview.assistant')}
                      </span>
                      <p className="line-clamp-4 whitespace-pre-wrap">
                        {message.text}
                      </p>
                    </div>
                  </div>
                ))}
      </div>
    </m.div>,
    document.body,
  )
}
