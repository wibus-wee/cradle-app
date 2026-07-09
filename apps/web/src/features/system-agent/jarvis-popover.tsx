import {
  AttachmentLine as PaperclipIcon,
  CloseLine as XIcon,
  Cursor2Line as MousePointer2Icon,
  DotCircleLine as CircleDotIcon,
  FolderLine as FolderIcon,
  FullscreenLine as MaximizeIcon,
  LayoutLine as PanelsTopLeftIcon,
  Message1Line as MessageSquareIcon,
  MinimizeLine as MinimizeIcon,
} from '@mingcute/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import { m } from 'motion/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { postSessions } from '~/api-gen/sdk.gen'
import { useLayoutGeometry } from '~/components/layout/layout-geometry-context'
import { CENTER_COLUMN_EXPANDED_SCALE, CENTER_COLUMN_EXPANDED_Y } from '~/components/layout/layout-motion'
import { Button } from '~/components/ui/button'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { ChatRuntimeView } from '~/features/chat/chat-runtime-view'
import type { ChatViewProps } from '~/features/chat/chat-view'
import type { ComposerSendHandler } from '~/features/chat/composer/composer'
import { Composer } from '~/features/chat/composer/composer'
import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import { ChatSessionSyncBoundary } from '~/features/chat/session/chat-session-sync-boundary'
import { startOptimisticChatResponse } from '~/features/chat/session/optimistic-chat-turn'
import { readSessionThinkingEffort } from '~/features/chat/session/session-thinking-effort'
import { cn } from '~/lib/cn'
import { useActiveSurface } from '~/navigation/active-surface'

import { stripCradleContextForDisplay } from './display-context'
import type { ExplicitContextAttachment } from './explicit-context'
import {
  addCurrentTextSelectionAttachment,
  clearExplicitContextAttachments,
  removeExplicitContextAttachment,
  useExplicitContextAttachments,
} from './explicit-context'
import { formatContextEnvelopeForAgent } from './format-context'
import { useJarvisUiStore } from './jarvis-ui-store'
import { collectContextEnvelope } from './use-context-snapshot'
import { useJarvisPreferences } from './use-jarvis-preferences'

const FALLBACK_EXPANDED_BOUNDS = { top: 44, left: 268, width: 800, height: 600 }
const PANEL_MIN_WIDTH = 320
const PANEL_MAX_WIDTH = 900
const PANEL_MIN_HEIGHT = 300
const PANEL_MAX_HEIGHT = 800
const MAX_CONTEXT_LABEL_CHARS = 32
const JARVIS_DEFAULT_SESSION_TITLE = 'Jarvis'

function resolveExpandedCenterRect(rect: {
  top: number
  left: number
  width: number
  height: number
}) {
  const width = rect.width * CENTER_COLUMN_EXPANDED_SCALE
  const height = rect.height * CENTER_COLUMN_EXPANDED_SCALE

  return {
    top: rect.top + (rect.height - height) / 2 + CENTER_COLUMN_EXPANDED_Y,
    left: rect.left + (rect.width - width) / 2,
    width,
    height,
  }
}

function ActiveContextIcon({ tabType }: { tabType: string | null }) {
  switch (tabType) {
    case 'chat':
    case 'new-chat':
      return <MessageSquareIcon className="size-3.5 shrink-0" aria-hidden="true" />
    case 'workspace-detail':
      return <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
    case 'kanban-board':
      return <CircleDotIcon className="size-3.5 shrink-0" aria-hidden="true" />
    default:
      return <PanelsTopLeftIcon className="size-3.5 shrink-0" aria-hidden="true" />
  }
}

function clipContextLabel(label: string): string {
  const trimmed = label.trim()
  if (trimmed.length <= MAX_CONTEXT_LABEL_CHARS) {
    return trimmed
  }

  return `${trimmed.slice(0, MAX_CONTEXT_LABEL_CHARS).trimEnd()}...`
}

function buildJarvisPromptText(text: string, includeContext: boolean): string {
  const envelope = collectContextEnvelope()
  const contextItems = includeContext
    ? envelope.items
    : envelope.items.filter(item => item.id.startsWith('explicit:'))
  const contextBlock = contextItems.length > 0
    ? formatContextEnvelopeForAgent({ ...envelope, items: contextItems })
    : ''

  return contextBlock ? `${contextBlock}\n\n${text}` : text
}

function readSessionRuntimeKind(value: unknown): RuntimeKind | undefined {
  return typeof value === 'string' && value.length > 0 ? value as RuntimeKind : undefined
}

function JarvisContextToolbar({
  attachments,
  onRemoveAttachment,
}: {
  attachments: ExplicitContextAttachment[]
  onRemoveAttachment: (id: string) => void
}) {
  const { t } = useTranslation('system-agent')

  if (attachments.length === 0) {
    return null
  }

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      {attachments.map(attachment => (
        <div
          key={attachment.id}
          className="inline-flex h-6 max-w-36 shrink items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 text-[11px] text-muted-foreground"
        >
          <PaperclipIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{attachment.title}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="-mr-1 size-4 rounded-sm text-muted-foreground/70 hover:text-foreground"
            onClick={() => onRemoveAttachment(attachment.id)}
            aria-label={t('action.removeContext')}
          >
            <XIcon className="size-2.5" aria-hidden="true" />
          </Button>
        </div>
      ))}
    </div>
  )
}

function JarvisContextBar({
  activeContextLabel,
  activeContextType,
  disabled,
  includeContext,
  onAttachSelection,
  onToggleIncludeContext,
}: {
  activeContextLabel: string
  activeContextType: string | null
  disabled?: boolean
  includeContext: boolean
  onAttachSelection: () => void
  onToggleIncludeContext: () => void
}) {
  const { t } = useTranslation('system-agent')

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        role="switch"
        aria-checked={includeContext}
        aria-label={`${t('input.includeContext')}: ${activeContextLabel}`}
        disabled={disabled}
        onClick={onToggleIncludeContext}
        className={cn(
          'min-w-0 max-w-36 justify-start overflow-hidden px-1.5 text-[11px]',
          {
            'text-foreground': includeContext,
            'text-muted-foreground/55 hover:text-muted-foreground': !includeContext,
          },
        )}
      >
        <ActiveContextIcon tabType={activeContextType} />
        <span className="min-w-0 truncate">{activeContextLabel}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        onClick={onAttachSelection}
        aria-label={t('action.attachSelection')}
      >
        <PaperclipIcon />
      </Button>
    </div>
  )
}

function JarvisEmptyState({
  hasProfile,
  sendError,
}: {
  hasProfile: boolean
  sendError: string | null
}) {
  const { t } = useTranslation('system-agent')

  return (
    <div className="flex h-full min-h-72 flex-col items-center justify-center px-8">
      <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-muted">
        <MousePointer2Icon className="size-4.5 !text-foreground" />
      </div>
      {!hasProfile
        ? (
            <>
              <p className="mb-1.5 text-[13px] font-medium text-foreground">{t('empty.noProfile.title')}</p>
              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                {t('empty.noProfile.description')}
              </p>
            </>
          )
        : (
            <>
              <p className="mb-1.5 text-[13px] font-medium text-foreground">{t('empty.ready.title')}</p>
              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                {t('empty.ready.description')}
              </p>
              {sendError && <p className="mt-3 text-center text-xs text-destructive/80">{sendError}</p>}
            </>
          )}
    </div>
  )
}

function JarvisDraftPanel({
  activeContextBar,
  contextToolbar,
  creating,
  hasProfile,
  onSend,
  placeholder,
  sendError,
}: {
  activeContextBar: React.ReactNode
  contextToolbar: React.ReactNode
  creating: boolean
  hasProfile: boolean
  onSend: ComposerSendHandler
  placeholder: string
  sendError: string | null
}) {
  const { t } = useTranslation('system-agent')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <JarvisEmptyState hasProfile={hasProfile} sendError={sendError} />
      </div>
      <div className="shrink-0 px-4 pb-3">
        <div className="mx-auto w-full max-w-208">
          <Composer
            send={{
              submit: onSend,
              disabled: !hasProfile,
              isSending: creating,
              sendDisabled: creating,
            }}
            slots={{
              toolbar: contextToolbar,
              contextBar: activeContextBar,
            }}
            view={{
              placeholder,
              textareaRows: 3,
              sessionId: null,
              cardClassName: 'shadow-[var(--shadow-xs)]',
            }}
            attachments={{ supportsAttachments: false }}
            accessibility={{
              textareaAriaLabel: t('input.aria'),
            }}
          />
        </div>
      </div>
    </div>
  )
}

function JarvisRuntimePanel({
  active,
  composerContextBar,
  composerToolbarAddon,
  prepareSend,
  prefsRuntimeKind,
  prefsModelId,
  prefsProviderTargetId,
  sessionId,
  placeholder,
}: {
  active: boolean
  composerContextBar: React.ReactNode
  composerToolbarAddon: React.ReactNode
  prepareSend: NonNullable<ChatViewProps['prepareSend']>
  prefsRuntimeKind?: RuntimeKind
  prefsModelId?: string | null
  prefsProviderTargetId?: string | null
  sessionId: string
  placeholder: string
}) {
  const { data: session } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId } }),
    enabled: !!sessionId,
  })
  const updateSessionTitle = useJarvisUiStore(s => s.updateSessionTitle)

  const runtimeKind = readSessionRuntimeKind(session?.runtimeKind) ?? prefsRuntimeKind
  const workspaceId = session?.workspaceId ?? null
  const sessionProviderTargetId = session?.providerTargetId ?? prefsProviderTargetId ?? null
  const sessionModelId = session?.modelId ?? prefsModelId ?? null
  const sessionThinkingEffort = readSessionThinkingEffort(session?.thinkingEffort)
  const agentId = session?.agentId ?? null

  React.useEffect(() => {
    const title = session?.title?.trim()
    if (!title || title === JARVIS_DEFAULT_SESSION_TITLE) {
      return
    }
    updateSessionTitle(sessionId, title)
  }, [session?.title, sessionId, updateSessionTitle])

  return (
    <div className="min-h-0 flex-1">
      <ChatSessionSyncBoundary sessionId={sessionId} active={active} />
      <ChatRuntimeView
        sessionId={sessionId}
        sessionProviderTargetId={sessionProviderTargetId}
        sessionModelId={sessionModelId}
        sessionThinkingEffort={sessionThinkingEffort}
        runtimeKind={runtimeKind}
        workspaceId={workspaceId}
        agentId={agentId}
        composerContextBar={composerContextBar}
        composerToolbarAddon={composerToolbarAddon}
        hideRuntimeToolbar
        compactInset
        placeholder={placeholder}
        messageTextTransform={stripCradleContextForDisplay}
        prepareSend={prepareSend}
      />
    </div>
  )
}

export function JarvisPopover({
  open,
  onOpenChange,
  anchorRef,
  anchorKey,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: React.RefObject<HTMLElement | null>
  anchorKey: string
}) {
  const { t } = useTranslation('system-agent')
  const queryClient = useQueryClient()
  const [creating, setCreating] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const explicitAttachments = useExplicitContextAttachments()
  const [anchorBounds, setAnchorBounds] = React.useState<{ left: number, width: number } | null>(null)
  const [sendError, setSendError] = React.useState<string | null>(null)

  const jarvisExpanded = useJarvisUiStore(s => s.expanded)
  const setJarvisExpanded = useJarvisUiStore(s => s.setExpanded)
  const panelWidth = useJarvisUiStore(s => s.panelWidth)
  const panelHeight = useJarvisUiStore(s => s.panelHeight)
  const setPanelSize = useJarvisUiStore(s => s.setPanelSize)
  const activeSessionId = useJarvisUiStore(s => s.activeSessionId)
  const setActiveSessionId = useJarvisUiStore(s => s.setActiveSessionId)
  const addSession = useJarvisUiStore(s => s.addSession)
  const includeContext = useJarvisUiStore(s => s.includeContext)
  const setIncludeContext = useJarvisUiStore(s => s.setIncludeContext)
  const activeSurface = useActiveSurface()
  const activeAmbientContext = {
    label: activeSurface ? activeSurface.title || activeSurface.kind : null,
    type: activeSurface?.kind ?? null,
  }

  const { centerColumnRect, footerRect } = useLayoutGeometry()
  const { prefs, isSuccess: preferencesReady } = useJarvisPreferences()
  const hasProfile = Boolean(prefs?.profileId)
  const contextSwitchLabel = clipContextLabel(activeAmbientContext.label ?? t('input.includeContext'))
  const jarvisReady = preferencesReady

  React.useEffect(() => {
    if (!open && jarvisExpanded) {
      setJarvisExpanded(false)
    }
  }, [open, jarvisExpanded, setJarvisExpanded])

  React.useEffect(() => {
    if (!open) {
      return
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (jarvisExpanded) {
          setJarvisExpanded(false)
        }
        else {
          onOpenChange(false)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange, jarvisExpanded, setJarvisExpanded])

  React.useLayoutEffect(() => {
    if (!open) {
      return
    }

    const readAnchorBounds = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      const nextBounds = rect ? { left: rect.left, width: rect.width } : null
      setAnchorBounds(previousBounds => (
        previousBounds?.left === nextBounds?.left && previousBounds?.width === nextBounds?.width
          ? previousBounds
          : nextBounds
      ))
    }

    readAnchorBounds()
    const frameId = requestAnimationFrame(readAnchorBounds)
    const observer = new ResizeObserver(readAnchorBounds)
    const anchor = anchorRef.current
    if (anchor) {
      observer.observe(anchor)
    }
    window.addEventListener('resize', readAnchorBounds)

    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      window.removeEventListener('resize', readAnchorBounds)
    }
  }, [open, anchorKey, anchorRef])

  const handleAttachSelection = React.useCallback(() => {
    const attachment = addCurrentTextSelectionAttachment()
    if (!attachment) {
      setSendError(t('error.noTextSelection'))
    }
    else {
      setSendError(null)
    }
  }, [t])

  const handleIncludeContextToggle = React.useCallback(() => {
    setIncludeContext(!includeContext)
  }, [includeContext, setIncludeContext])

  const prepareJarvisSend = React.useCallback<NonNullable<ChatViewProps['prepareSend']>>(
    ({ text, files, contextParts, options }) => {
      const preparedText = buildJarvisPromptText(text, includeContext)
      clearExplicitContextAttachments()
      setSendError(null)
      return {
        text: preparedText,
        files,
        contextParts,
        options,
      }
    },
    [includeContext],
  )

  const handleDraftSend = React.useCallback<ComposerSendHandler>(async (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
  ) => {
    const trimmedText = text.trim()
    if (!trimmedText || !prefs?.profileId || creating) {
      return false
    }

    setCreating(true)
    setSendError(null)
    const preparedText = buildJarvisPromptText(trimmedText, includeContext)

    try {
      const res = await postSessions({
        body: {
          workspaceId: null,
          title: 'Jarvis',
          providerTargetId: prefs.profileId,
          modelId: prefs.model,
          runtimeKind: prefs.runtimeKind,
        },
      })
      const session = res.data as {
        id?: string
        title?: string | null
        workspaceId?: string | null
        runtimeKind?: RuntimeKind
      } | null
      if (!session?.id) {
        setSendError(
          res.error
            ? String((res.error as { message?: string }).message ?? res.error)
            : t('error.sessionCreationFailed'),
        )
        setCreating(false)
        return false
      }

      addSession({
        id: session.id,
        title: trimmedText.slice(0, 40) || JARVIS_DEFAULT_SESSION_TITLE,
        createdAt: Date.now(),
      })
      setActiveSessionId(session.id)
      clearExplicitContextAttachments()
      startOptimisticChatResponse({
        sessionId: session.id,
        queryClient,
        body: {
          text: preparedText,
          files,
          contextParts,
          providerTargetId: prefs.profileId,
          modelId: prefs.model,
        },
      })
      setCreating(false)
      return true
    }
    catch (e) {
      setSendError(e instanceof Error ? e.message : t('error.createSessionFailed'))
      setCreating(false)
      return false
    }
  }, [
    addSession,
    creating,
    includeContext,
    prefs,
    queryClient,
    setActiveSessionId,
    t,
  ])

  const contextBar = (
    <JarvisContextBar
      activeContextLabel={contextSwitchLabel}
      activeContextType={activeAmbientContext.type}
      disabled={!hasProfile}
      includeContext={includeContext}
      onAttachSelection={handleAttachSelection}
      onToggleIncludeContext={handleIncludeContextToggle}
    />
  )
  const contextToolbar = (
    <JarvisContextToolbar
      attachments={explicitAttachments}
      onRemoveAttachment={removeExplicitContextAttachment}
    />
  )

  const expandedBounds = (() => {
    if (!centerColumnRect) {
      return FALLBACK_EXPANDED_BOUNDS
    }
    const expandedCenterRect = resolveExpandedCenterRect(centerColumnRect)
    return {
      top: expandedCenterRect.top + 12,
      left: expandedCenterRect.left - 8,
      width: expandedCenterRect.width + 16,
      height: expandedCenterRect.height + 4,
    }
  })()

  const popoverBounds = (() => {
    if (!footerRect) {
      return { top: 0, left: 0, width: panelWidth, height: panelHeight }
    }
    const centerX = anchorBounds
      ? anchorBounds.left + anchorBounds.width / 2
      : footerRect.right - 12 - panelWidth / 2
    const left = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, centerX - panelWidth / 2))
    return {
      top: footerRect.top - 8 - panelHeight,
      left,
      width: panelWidth,
      height: panelHeight,
    }
  })()

  const targetBounds = jarvisExpanded ? expandedBounds : popoverBounds

  const resizingRef = React.useRef(false)
  const resizeStartRef = React.useRef({ x: 0, y: 0, w: 0, h: 0 })
  const [isResizing, setIsResizing] = React.useState(false)

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    resizingRef.current = true
    setIsResizing(true)
    resizeStartRef.current = { x: e.clientX, y: e.clientY, w: panelWidth, h: panelHeight }

    const handleMove = (ev: PointerEvent) => {
      if (!resizingRef.current) {
        return
      }
      const dx = resizeStartRef.current.x - ev.clientX
      const dy = resizeStartRef.current.y - ev.clientY
      const newW = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, resizeStartRef.current.w + dx))
      const newH = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, resizeStartRef.current.h + dy))
      setPanelSize(newW, newH)
    }

    const handleUp = () => {
      resizingRef.current = false
      setIsResizing(false)
      document.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerup', handleUp)
    }

    document.addEventListener('pointermove', handleMove)
    document.addEventListener('pointerup', handleUp)
  }

  return (
    <m.div
      ref={panelRef}
      data-testid="jarvis-popover"
      data-jarvis-ready={jarvisReady ? 'true' : 'false'}
      initial={false}
      animate={{
        opacity: open ? 1 : 0,
        y: open ? 0 : 8,
        ...targetBounds,
      }}
      exit={{ opacity: 0, y: 8 }}
      transition={
        isResizing
          ? { duration: 0 }
          : {
              opacity: { duration: 0.15 },
              y: { duration: 0.2 },
              top: { type: 'spring', duration: 0.4, bounce: 0 },
              left: { type: 'spring', duration: 0.4, bounce: 0 },
              width: { type: 'spring', duration: 0.35, bounce: 0 },
              height: { type: 'spring', duration: 0.35, bounce: 0 },
            }
      }
      style={{ pointerEvents: open ? 'auto' : 'none', visibility: open ? 'visible' : 'hidden' }}
      className={cn(
        'fixed z-50 flex flex-col',
        'overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground',
        jarvisExpanded && 'shadow-[var(--shadow-xs)]',
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <MousePointer2Icon className="size-3.5 !text-muted-foreground" />
            <span className="text-[13px] font-medium text-foreground">Jarvis</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setJarvisExpanded(!jarvisExpanded)}
              aria-label={jarvisExpanded ? t('action.collapse') : t('action.expand')}
            >
              {jarvisExpanded ? <MinimizeIcon /> : <MaximizeIcon />}
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setJarvisExpanded(false)
                onOpenChange(false)
              }}
              aria-label={t('action.close')}
            >
              <XIcon />
            </Button>
          </div>
        </div>

        {activeSessionId
          ? (
              <JarvisRuntimePanel
                active={open}
                composerContextBar={contextBar}
                composerToolbarAddon={contextToolbar}
                prepareSend={prepareJarvisSend}
                prefsRuntimeKind={prefs?.runtimeKind}
                prefsModelId={prefs?.model ?? null}
                prefsProviderTargetId={prefs?.profileId ?? null}
                sessionId={activeSessionId}
                placeholder={t('input.placeholder.ask')}
              />
            )
          : (
              <JarvisDraftPanel
                activeContextBar={contextBar}
                contextToolbar={contextToolbar}
                creating={creating}
                hasProfile={hasProfile}
                onSend={handleDraftSend}
                placeholder={!hasProfile ? t('input.placeholder.configureProfile') : t('input.placeholder.ask')}
                sendError={sendError}
              />
            )}
      </div>

      {!jarvisExpanded && (
        <div
          className={cn(
            'absolute left-0 top-0 size-4 cursor-nwse-resize opacity-0 transition-opacity hover:opacity-100',
            'before:absolute before:left-1 before:top-1 before:size-1.5 before:rounded-full before:bg-muted-foreground/40',
          )}
          onPointerDown={handleResizeStart}
          aria-hidden="true"
        />
      )}
    </m.div>
  )
}
