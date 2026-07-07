import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { DragDropProvider, DragOverlay } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import {
  Chat3Line as MessageCircleMoreIcon,
  CloseLine as XIcon,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'

import { useRunningSessionIds, useUnreadSessionIds } from '~/features/workspace/use-session'
import { cn } from '~/lib/cn'
import { nativeIpc, subscribePointerOutsideWindow } from '~/lib/electron'
import { chatSelectors, useChatStore } from '~/store/chat'
import { useSettingsOverlayStore } from '~/store/settings-overlay'

import { useActiveSurface } from './active-surface'
import { activateSurface, closeSurfaceById, openNewChat } from './navigation-commands'
import type { ClientCoordinates, ScreenCoordinates } from './screen-coordinates'
import { getEventClientCoordinates, getEventScreenCoordinates, isPointerOutsideWindow } from './screen-coordinates'
import { SurfaceIcon } from './surface-icon'
import type { AppSurface } from './surface-identity'
import { sortSurfaces } from './surface-identity'
import { useSurfaceStore } from './surface-store'
import { openTearoffSurfaceWindow } from './tearoff-surfaces'

const META_TAB_HINT_DELAY_MS = 200
const TEAR_OFF_RELEASE_DISTANCE_PX = 48

type SurfaceDragOutcome = 'tear-off'

function readNumberShortcutIndex(event: KeyboardEvent): number | null {
  if (/^[1-9]$/.test(event.key)) {
    return Number(event.key) - 1
  }

  const digitMatch = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)
  if (!digitMatch) {
    return null
  }

  return Number(digitMatch[1]) - 1
}

function getDragDistance(start: ScreenCoordinates | null, end: ScreenCoordinates | null): number {
  if (!start || !end) {
    return 0
  }

  return Math.hypot(end.screenX - start.screenX, end.screenY - start.screenY)
}

function readChatSessionId(surface: AppSurface): string | null {
  return surface.kind === 'chat' && surface.route.to === '/chat/$sessionId'
    ? surface.route.params.sessionId
    : null
}

interface SurfacePillProps {
  surface: AppSurface
  isActive: boolean
  shortcutHint?: number
  showShortcutHint: boolean
  running: boolean
  unread: boolean
  onActivate: (surfaceId: string) => void
  onClose: (event: React.MouseEvent, surfaceId: string) => void
}

function SurfaceRunningIndicator() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-4 shrink-0 items-center justify-center gap-0.5 text-primary [contain:layout_paint]"
    >
      <span className="size-1 rounded-full bg-current opacity-30 animate-[surface-running-dot_1.2s_ease-in-out_infinite] motion-reduce:animate-none" />
      <span className="size-1 rounded-full bg-current opacity-30 animate-[surface-running-dot_1.2s_ease-in-out_infinite] [animation-delay:0.16s] motion-reduce:animate-none" />
      <span className="size-1 rounded-full bg-current opacity-30 animate-[surface-running-dot_1.2s_ease-in-out_infinite] [animation-delay:0.32s] motion-reduce:animate-none" />
    </span>
  )
}

const SortableSurfacePill = memo(({
  surface,
  index,
  isActive,
  shortcutHint,
  showShortcutHint,
  running,
  unread,
  onActivate,
  onClose,
}: SurfacePillProps & { index: number }) => {
  const sortable = useSortable({ id: surface.id, index })

  const shortcutSlot = shortcutHint === undefined
    ? null
    : (
        <span
          aria-hidden="true"
          className="inline-flex size-4 items-center justify-center rounded-sm bg-foreground/6 font-mono text-[10px] font-medium leading-none tabular-nums text-foreground/65"
        >
          {shortcutHint}
        </span>
      )
  const showBadgeSlot = unread && !showShortcutHint
  const showRunningSlot = running && !showShortcutHint

  return (
    <div
      ref={sortable.ref}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={() => onActivate(surface.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onActivate(surface.id)
        }
      }}
      role="tab"
      tabIndex={0}
      aria-selected={isActive}
      data-testid={`surface-pill-${surface.id}`}
      data-surface-active={isActive ? 'true' : 'false'}
      data-surface-pinned={surface.closable ? 'false' : 'true'}
      className={cn(
        'group relative mx-0.5 flex h-7.5 flex-1 cursor-default items-center justify-start gap-1.5 overflow-hidden rounded-md bg-background text-[11px] font-medium transition-[opacity,background-color,color,box-shadow] duration-100 min-w-8 max-w-44',
        surface.closable ? 'pl-3 pr-7' : 'px-3',
        isActive
          ? 'text-foreground shadow-xs'
          : 'text-muted-foreground opacity-70 hover:text-foreground/70 hover:opacity-100!',
        sortable.isDragging && 'opacity-50 z-10',
      )}
    >
      <span className="relative flex size-4 shrink-0 items-center justify-center">
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center transition-[opacity,transform,filter] duration-150 ease-out',
            showShortcutHint || showRunningSlot || showBadgeSlot ? 'scale-[0.92] opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-0',
          )}
        >
          <SurfaceIcon surface={surface} />
        </span>
        {running && (
          <span
            role="status"
            aria-label="Session running"
            className={cn(
              'absolute inset-0 inline-flex items-center justify-center transition-[opacity,transform,filter] duration-150 ease-out',
              showRunningSlot ? 'scale-100 opacity-100 blur-0' : 'scale-[0.92] opacity-0 blur-[2px]',
            )}
          >
            <SurfaceRunningIndicator />
          </span>
        )}
        {unread && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-0 inline-flex items-center justify-center text-primary transition-[opacity,transform,filter] duration-150 ease-out',
              showBadgeSlot && !showRunningSlot ? 'scale-100 opacity-100 blur-0' : 'scale-[0.92] opacity-0 blur-[2px]',
            )}
          >
            <MessageCircleMoreIcon className="size-3.5" />
            <span className="absolute right-0 top-0 size-1.5 rounded-full bg-primary ring-2 ring-background" />
          </span>
        )}
        {shortcutSlot && (
          <span
            className={cn(
              'absolute inset-0 flex items-center justify-center transition-[opacity,transform,filter] duration-150 ease-out',
              showShortcutHint ? 'scale-100 opacity-100 blur-0' : 'scale-[0.92] opacity-0 blur-[2px]',
            )}
          >
            {shortcutSlot}
          </span>
        )}
      </span>
      <span className="truncate select-none">{surface.title}</span>
      {surface.closable && (
        <button
          type="button"
          aria-label={`Close ${surface.title}`}
          onClick={event => onClose(event, surface.id)}
          data-testid={`surface-close-${surface.id}`}
          className={cn(
            'absolute right-0 top-1/2 z-10 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-transparent p-0',
            'text-muted-foreground opacity-0 transition-[opacity,color,background-color] hover:bg-foreground/6 hover:text-foreground',
            'group-hover:opacity-80 group-data-[surface-active=true]:opacity-100',
          )}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  )
})
SortableSurfacePill.displayName = 'SortableSurfacePill'

export const SurfaceBar = memo(({
  className,
  sessionScoped = false,
  runningSessionIds: externalRunningSessionIds,
  unreadSessionIds: externalUnreadSessionIds,
}: {
  className?: string
  sessionScoped?: boolean
  runningSessionIds?: ReadonlySet<string>
  unreadSessionIds?: ReadonlySet<string>
}) => {
  'use no memo'

  const surfaces = useSurfaceStore(state => state.surfaces)
  const activeSurface = useActiveSurface()
  const settingsReturnSurfaceId = useSettingsOverlayStore(state => state.settingsReturnSurfaceId)
  const activeSurfaceId = activeSurface?.kind === 'settings'
    ? settingsReturnSurfaceId
    : activeSurface?.id ?? null
  const reorderSurfaces = useSurfaceStore(state => state.reorderSurfaces)
  const sessionListUnreadSessionIds = useUnreadSessionIds()
  const chatSessionIds = useMemo(() => {
    const ids: string[] = []
    for (const surface of surfaces) {
      const sessionId = readChatSessionId(surface)
      if (sessionId) {
        ids.push(sessionId)
      }
    }
    return ids
  }, [surfaces])
  const sessionListRunningSessionIds = useRunningSessionIds()
  const serverRunningSessionIds = externalRunningSessionIds ?? sessionListRunningSessionIds
  const unreadSessionIds = externalUnreadSessionIds ?? sessionListUnreadSessionIds
  const locallyRunningSessionIds = useChatStore(
    useCallback(
      state => new Set(
        chatSessionIds.filter(sessionId => chatSelectors.isSessionStreaming(sessionId)(state)),
      ),
      [chatSessionIds],
    ),
    shallow,
  )
  const surfacesRef = useRef(surfaces)
  const dragStartPointerRef = useRef<ScreenCoordinates | null>(null)
  const dragReleasePointerRef = useRef<ScreenCoordinates | null>(null)
  const dragReleaseClientPointerRef = useRef<ClientCoordinates | null>(null)
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const [showMetaTabHints, setShowMetaTabHints] = useState(false)
  surfacesRef.current = surfaces

  const releaseCurrentDrag = useCallback(() => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null
    dragStartPointerRef.current = null
    dragReleasePointerRef.current = null
    dragReleaseClientPointerRef.current = null
  }, [])

  const handleActivate = useCallback((surfaceId: string) => {
    activateSurface(surfaceId)
  }, [])

  const handleClose = useCallback((event: React.MouseEvent, surfaceId: string) => {
    event.stopPropagation()
    closeSurfaceById(surfaceId)
  }, [])

  useEffect(() => {
    let metaHintTimerId: number | null = null

    const clearMetaHintTimer = () => {
      if (metaHintTimerId === null) {
        return
      }
      window.clearTimeout(metaHintTimerId)
      metaHintTimerId = null
    }

    const hideMetaTabHints = () => {
      clearMetaHintTimer()
      setShowMetaTabHints(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }

      if (event.key === 'Meta' && !event.repeat && metaHintTimerId === null) {
        metaHintTimerId = window.setTimeout(() => {
          metaHintTimerId = null
          setShowMetaTabHints(true)
        }, META_TAB_HINT_DELAY_MS)
      }

      if (!event.metaKey || event.altKey || event.shiftKey) {
        return
      }

      const shortcutIndex = readNumberShortcutIndex(event)
      if (shortcutIndex === null) {
        return
      }

      const targetSurface = surfacesRef.current[shortcutIndex]
      if (!targetSurface) {
        return
      }

      event.preventDefault()
      handleActivate(targetSurface.id)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Meta') {
        hideMetaTabHints()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', hideMetaTabHints)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', hideMetaTabHints)
      clearMetaHintTimer()
    }
  }, [handleActivate])

  // Resolve how a pill drag should be interpreted at release time.
  // Returns 'tear-off' (dragged out of the window → standalone window), or null (no-op).
  const resolveDragOutcome = useCallback((): SurfaceDragOutcome | null => {
    if (sessionScoped) {
      return null
    }

    const releasePointer = dragReleasePointerRef.current
    const startPointer = dragStartPointerRef.current

    if (getDragDistance(startPointer, releasePointer) <= TEAR_OFF_RELEASE_DISTANCE_PX) {
      return null
    }

    if (!releasePointer) {
      return null
    }

    if (isPointerOutsideWindow(releasePointer, window)) {
      return 'tear-off'
    }

    return null
  }, [sessionScoped])

  const checkTearOff = useCallback((surfaceId: string | number): boolean => {
    dragCleanupRef.current?.()
    dragCleanupRef.current = null

    if (resolveDragOutcome() !== 'tear-off') {
      return false
    }

    const releasePointer = dragReleasePointerRef.current
    dragReleasePointerRef.current = null

    const surface = useSurfaceStore.getState().surfaces.find(item => item.id === surfaceId)
    if (!surface || !releasePointer) {
      return false
    }

    void openTearoffSurfaceWindow(surface, {
      screenX: releasePointer.screenX,
      screenY: releasePointer.screenY,
      detachSurface: true,
    })
    return true
  }, [resolveDragOutcome])

  const handleDragStart = useCallback((event: { operation: { source: { id: string | number } | null }, nativeEvent?: Event }) => {
    const startPointer = getEventScreenCoordinates(event.nativeEvent ?? null, window)
    const startClientPointer = getEventClientCoordinates(event.nativeEvent ?? null)
    dragStartPointerRef.current = startPointer
    dragReleasePointerRef.current = startPointer
    dragReleaseClientPointerRef.current = startClientPointer
    dragCleanupRef.current?.()

    const updateReleasePointer = (pointerEvent: MouseEvent | PointerEvent | TouchEvent) => {
      dragReleasePointerRef.current = getEventScreenCoordinates(pointerEvent, window)
      dragReleaseClientPointerRef.current = getEventClientCoordinates(pointerEvent)
    }

    window.addEventListener('mousemove', updateReleasePointer, true)
    window.addEventListener('pointermove', updateReleasePointer, true)
    window.addEventListener('touchmove', updateReleasePointer, true)
    window.addEventListener('mouseup', updateReleasePointer, true)
    window.addEventListener('pointerup', updateReleasePointer, true)
    window.addEventListener('touchend', updateReleasePointer, true)
    const unsubscribePointerOutsideWindow = subscribePointerOutsideWindow((screenX, screenY) => {
      dragReleasePointerRef.current = { screenX, screenY }
      dragReleaseClientPointerRef.current = null
    })
    void nativeIpc?.window.startPointerMonitor().catch(() => {})
    dragCleanupRef.current = () => {
      window.removeEventListener('mousemove', updateReleasePointer, true)
      window.removeEventListener('pointermove', updateReleasePointer, true)
      window.removeEventListener('touchmove', updateReleasePointer, true)
      window.removeEventListener('mouseup', updateReleasePointer, true)
      window.removeEventListener('pointerup', updateReleasePointer, true)
      window.removeEventListener('touchend', updateReleasePointer, true)
      unsubscribePointerOutsideWindow()
      void nativeIpc?.window.stopPointerMonitor().catch(() => {})
    }
  }, [resolveDragOutcome])

  useEffect(() => releaseCurrentDrag, [releaseCurrentDrag])

  const handleDragEnd = useCallback((event: { operation: { source: { id: string | number } | null, target: { id: string | number } | null }, canceled: boolean }) => {
    const { operation, canceled } = event
    const { source, target } = operation
    if (canceled) {
      if (source) {
        checkTearOff(source.id)
      }
      releaseCurrentDrag()
      return
    }
    if (!source || checkTearOff(source.id)) {
      releaseCurrentDrag()
      return
    }
    // No pill drop target → released on the content area or in place (no-op).
    if (!target || source.id === target.id) {
      releaseCurrentDrag()
      return
    }
    const currentSurfaces = sortSurfaces(useSurfaceStore.getState().surfaces)
    const oldIndex = currentSurfaces.findIndex(surface => surface.id === source.id)
    const newIndex = currentSurfaces.findIndex(surface => surface.id === target.id)
    if (oldIndex === -1 || newIndex === -1) {
      releaseCurrentDrag()
      return
    }
    const reordered = [...currentSurfaces]
    const [moved] = reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, moved!)
    reorderSurfaces(reordered.map(surface => surface.id))
    releaseCurrentDrag()
  }, [checkTearOff, releaseCurrentDrag, reorderSurfaces])

  return (
    <DragDropProvider
      sensors={defaults => [
        ...defaults.filter(sensor => sensor !== PointerSensor),
        PointerSensor.configure({
          activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
        }),
      ]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div
        className={cn('flex items-center overflow-hidden px-0.5', className)}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        data-testid="surface-bar"
      >
        {surfaces.map((surface, index) => {
          const sessionId = readChatSessionId(surface)
          return (
            <SortableSurfacePill
              key={surface.id}
              surface={surface}
              index={index}
              isActive={surface.id === activeSurfaceId}
              shortcutHint={index < 9 ? index + 1 : undefined}
              showShortcutHint={showMetaTabHints}
              running={sessionId ? serverRunningSessionIds.has(sessionId) || locallyRunningSessionIds.has(sessionId) : false}
              unread={sessionId ? unreadSessionIds.has(sessionId) : false}
              onActivate={handleActivate}
              onClose={handleClose}
            />
          )
        })}

        <DragOverlay dropAnimation={null}>
          {(source) => {
            const surface = surfaces.find(s => s.id === source.id)
            if (!surface) { return null }
            return (
              <div
                className={cn(
                  'mx-0.5 flex h-7.5 max-w-44 cursor-grabbing items-center justify-start gap-1.5 overflow-hidden rounded-md border border-border/50 bg-background text-[11px] font-medium opacity-90 shadow-lg',
                  surface.closable ? 'pl-3 pr-7' : 'px-3',
                )}
              >
                <span className="shrink-0">
                  <SurfaceIcon surface={surface} />
                </span>
                <span className="truncate select-none">{surface.title}</span>
              </div>
            )
          }}
        </DragOverlay>

        {!sessionScoped && (
          <button
            type="button"
            aria-label="New tab"
            onClick={() => openNewChat()}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            data-testid="surface-new-btn"
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md',
              'text-muted-foreground/30 transition-colors hover:bg-foreground/4 hover:text-foreground/60',
            )}
          >
            <PlusIcon className="size-3" />
          </button>
        )}
      </div>
    </DragDropProvider>
  )
})
SurfaceBar.displayName = 'SurfaceBar'
