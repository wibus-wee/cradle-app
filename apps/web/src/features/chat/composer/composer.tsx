import {
  RouteLine as RouteIcon,
  SendPlaneLine as SendHorizonalIcon,
  SquareLine as SquareIcon,
  TerminalBoxLine as SquareTerminalIcon,
} from '@mingcute/react'

import { Spinner } from '~/components/ui/spinner'
import type { FileUIPart } from 'ai'
import type { ChangeEvent } from 'react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { toastManager } from '~/components/ui/toast'
import { useComposerDraftSync } from '~/hooks/use-composer-draft-sync'
import { cn } from '~/lib/cn'
import { isLocalMode } from '~/lib/electron'
import { formatTokenCount } from '~/lib/number-format'
import { readWorkspaceFileDragText } from '~/lib/workspace-drag-data'
import { useComposerDraftStore } from '~/store/composer-draft'

import type { ChatRuntimeCompactUiSlotState } from '../capabilities/chat-capabilities'
import { readBangCommand } from '../commands/bang-command'
import type { ChatRuntimeSettings, ChatRuntimeSettingsPatch } from '../commands/chat-response-command'
import type { ChatContextPart } from '../context/chat-context-parts'
import { ContextUsageDetailPanel } from '../context/context-usage-detail-panel'
import type { MentionItem, MentionPickerItem, PluginMentionItem } from '../mentions/mention-panel'
import { MentionPanel } from '../mentions/mention-panel'
import type { SkillMentionItem } from '../mentions/skill-mention-panel'
import { SkillMentionPanel } from '../mentions/skill-mention-panel'
import type { SendMessageResult } from '../session/use-chat-session'
import type { ChatComposerSlashCommand } from '../slash-commands/chat-slash-commands'
import {
  CHAT_SLASH_COMMAND_LISTBOX_ID,
  getActiveSlashCommand,
  getSlashCommandPanelItems,
  getSlashCommandPrefix,
  getVisibleSlashCommands,
  isSlashCommandAwaitingRequiredArgument,
  replaceSlashTrigger,
} from '../slash-commands/slash-command-input'
import { SlashCommandPanel } from '../slash-commands/slash-command-panel'
import type {
  ComposerActionContextOptions,
  ComposerSlashCommandActionContext,
  ComposerSlashCommandActionResult,
  ComposerSlashCommandActionTools,
} from './composer-action-context'
import { readComposerActionContext } from './composer-action-context'
import type { ComposerAttachmentController } from './composer-attachment-state'
import { useComposerAttachments } from './composer-attachment-state'
import type { PendingAppshotAttachment } from './composer-attachments'
import {
  ComposerAttachmentButton,
  ComposerAttachmentInput,
  ComposerAttachmentList,
} from './composer-attachments'
import type { PromptEditorController, PromptEditorSnapshot, PromptEditorTriggerRange } from './prompt-editor'
import { PromptEditor } from './prompt-editor'

type ComposerSendResult = SendMessageResult | boolean

export type ComposerSendHandler = (
  text: string,
  files: FileUIPart[],
  contextParts: ChatContextPart[],
  options?: { invertContinuationMode?: boolean },
) => ComposerSendResult | Promise<ComposerSendResult>

export interface ComposerSendController {
  submit: ComposerSendHandler
  submitInNewWindow?: ComposerSendHandler
  stop?: () => void
  isStreaming?: boolean
  isSending?: boolean
  disabled?: boolean
  sendDisabled?: boolean
  allowEmptySend?: boolean
  onQuickQuestion?: (question: string) => void
}

export interface ComposerCommandController {
  commands?: ChatComposerSlashCommand[]
  runAction?: (command: ChatComposerSlashCommand, context: ComposerSlashCommandActionContext, tools?: ComposerSlashCommandActionTools) => void | ComposerSlashCommandActionResult | Promise<void | ComposerSlashCommandActionResult>
}

export interface ComposerAttachmentIntegration {
  supportsAttachments?: boolean
  /** File parts injected externally, for example from native Appshot capture. */
  appendFileParts?: FileUIPart[]
  /** Used together with appendFileParts to re-trigger the append. */
  appendFilePartsKey?: number
  pendingAppshots?: PendingAppshotAttachment[]
  onActionTargetElementChange?: (element: HTMLDivElement | null) => void
}

export interface ComposerSlots {
  toolbar?: React.ReactNode
  contextBar?: React.ReactNode
  footer?: React.ReactNode
}

export interface ComposerExternalSignals {
  /** Replaces the current draft when the key changes, used by quick actions. */
  replaceText?: string
  replaceTextKey?: number
  /** Clears the current draft and attachments when the key changes. */
  clearDraftKey?: number
  /** Temporarily prevents the visible draft from being written to normal draft storage. */
  suspendDraftPersistence?: boolean
  /** Replaces the current structured draft when the key changes, used by queue edit. */
  replaceDraft?: {
    text: string
    contextParts: ChatContextPart[]
  }
  replaceDraftKey?: number
  /** Appends text to the composer input when the key changes, used by parent DnD. */
  appendText?: string
  appendTextKey?: number
}

export interface ComposerRuntimeSettingsController {
  settings: ChatRuntimeSettings
  disabled?: boolean
  onChange: (patch: ChatRuntimeSettingsPatch) => void
}

export interface ComposerViewOptions {
  placeholder?: string
  availableFiles?: MentionItem[]
  searchFiles?: (query: string, signal?: AbortSignal) => Promise<MentionItem[]>
  availablePlugins?: PluginMentionItem[]
  searchPlugins?: (query: string, signal?: AbortSignal) => Promise<PluginMentionItem[]>
  availableSkills?: SkillMentionItem[]
  searchSkills?: (query: string, signal?: AbortSignal) => Promise<SkillMentionItem[]>
  className?: string
  cardClassName?: string
  textareaClassName?: string
  textareaRows?: number
  /** Hides the prompt editor for runtimes that do not accept text input. */
  inputCollapsed?: boolean
  attachmentListClassName?: string
  actionBarClassName?: string
  toolbarClassName?: string
  actionsClassName?: string
  attachButtonClassName?: string
  attachIconClassName?: string
  sendButtonClassName?: string
  onDraftChange?: (value: string) => void
  /**
   * Fires with both text and context parts on every draft change.
   * Used by the draft persistence layer to capture the full editor state.
   */
  onDraftPartsChange?: (text: string, contextParts: ChatContextPart[]) => void
  onFocusChange?: (focused: boolean) => void
  sessionId?: string | null
  sessionTokens?: number
  sessionContextWindow?: number | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  /**
   * When provided, the composer persists its draft to per-surface localStorage
   * and restores it on remount. This prevents draft loss on tab switches.
   */
  surfaceId?: string
}

export interface ComposerTestIds {
  actionTarget?: string
  textarea?: string
  fileInput?: string
  attachButton?: string
  sendButton?: string
  stopButton?: string
}

export interface ComposerAccessibilityOptions {
  textareaAriaLabel?: string
  sendButtonAriaLabel?: string
}

export interface ComposerProps {
  send: ComposerSendController
  commands?: ComposerCommandController
  attachments?: ComposerAttachmentIntegration
  runtimeSettings?: ComposerRuntimeSettingsController
  slots?: ComposerSlots
  externalSignals?: ComposerExternalSignals
  view?: ComposerViewOptions
  testIds?: ComposerTestIds
  accessibility?: ComposerAccessibilityOptions
}

const EMPTY_FILES: MentionItem[] = []
const EMPTY_PLUGINS: PluginMentionItem[] = []
const EMPTY_SKILLS: SkillMentionItem[] = []
const EMPTY_SLASH_COMMANDS: ChatComposerSlashCommand[] = []
const LEADING_HORIZONTAL_WHITESPACE_RE = /^[ \t]+/
const BTW_QUICK_QUESTION_RE = /^\/btw\s+([\s\S]+)$/i
const textareaRowsClasses: Record<number, string> = {
  1: 'min-h-11 max-h-40',
  2: 'min-h-14 max-h-48',
  3: 'min-h-16 max-h-60',
  4: 'min-h-24 max-h-72',
  5: 'min-h-30 max-h-80',
}

function isComposerSendPromise(
  result: ComposerSendResult | Promise<ComposerSendResult>,
): result is Promise<ComposerSendResult> {
  return typeof result === 'object'
    && result !== null
    && 'then' in result
    && typeof result.then === 'function'
}

function reportComposerSubmitError(error: unknown) {
  console.error('[Composer] submit failed:', error)
  toastManager.add({
    type: 'error',
    title: 'Message submit failed',
    description: error instanceof Error ? error.message : 'Unknown submit error.',
  })
}

function clearSubmittedDraft({
  clearAttachments,
  dispatch,
  promptEditor,
}: {
  clearAttachments: () => void
  dispatch: (action: ComposerAction) => void
  promptEditor: PromptEditorController | null
}) {
  clearAttachments()
  promptEditor?.clear()
  dispatch({ type: 'input/cleared' })
}

function restoreSubmittedDraft({
  appendFileParts,
  contextParts,
  dispatch,
  files,
  promptEditor,
  text,
}: {
  appendFileParts: (fileParts: FileUIPart[]) => void
  contextParts: ChatContextPart[]
  dispatch: (action: ComposerAction) => void
  files: FileUIPart[]
  promptEditor: PromptEditorController | null
  text: string
}) {
  if (promptEditor?.getText().trim()) {
    return
  }

  if (files.length > 0) {
    appendFileParts(files)
  }
  promptEditor?.setText(text)
  dispatch({
    type: 'input/changed',
    state: {
      ...INITIAL_COMPOSER_STATE,
      inputValue: text,
      contextParts,
    },
  })
}

function submitAndClearDraft({
  appendFileParts,
  clearAttachments,
  contextParts,
  dispatch,
  files,
  options,
  promptEditor,
  submit,
  text,
}: {
  appendFileParts: (fileParts: FileUIPart[]) => void
  clearAttachments: () => void
  contextParts: ChatContextPart[]
  dispatch: (action: ComposerAction) => void
  files: FileUIPart[]
  options?: { invertContinuationMode?: boolean }
  promptEditor: PromptEditorController | null
  submit: ComposerSendHandler
  text: string
}) {
  let result: ComposerSendResult | Promise<ComposerSendResult>
  try {
    result = options
      ? submit(text, files, contextParts, options)
      : submit(text, files, contextParts)
  }
  catch (error) {
    reportComposerSubmitError(error)
    return
  }

  if (result === false) {
    return
  }

  clearSubmittedDraft({ clearAttachments, dispatch, promptEditor })

  if (isComposerSendPromise(result)) {
    void result
      .then((resolved) => {
        if (resolved === false) {
          restoreSubmittedDraft({ appendFileParts, contextParts, dispatch, files, promptEditor, text })
        }
      })
      .catch((error) => {
        reportComposerSubmitError(error)
        restoreSubmittedDraft({ appendFileParts, contextParts, dispatch, files, promptEditor, text })
      })
  }
}

function readBangCommandDraft(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('!') || normalized.includes('\n') || normalized.includes('\r')) {
    return null
  }
  const preview = normalized.slice(1).trim()
  return preview || '!'
}

interface ComposerState {
  inputValue: string
  mentionActive: boolean
  mentionQuery: string
  slashActive: boolean
  slashQuery: string
  skillActive: boolean
  skillQuery: string
  contextParts: ChatContextPart[]
  selectedSlashCommand: ChatComposerSlashCommand | null
}

type ComposerAction
  = | { type: 'input/changed', state: ComposerState }
  | { type: 'input/cleared' }
  | { type: 'mention/closed' }
  | { type: 'mention/selected' }
  | { type: 'slash/closed' }
  | { type: 'slash/selected', inputValue: string, command: ChatComposerSlashCommand | null }
  | { type: 'skill/closed' }
  | { type: 'skill/selected' }
  | { type: 'pickers/closed' }

const INITIAL_COMPOSER_STATE: ComposerState = {
  inputValue: '',
  mentionActive: false,
  mentionQuery: '',
  slashActive: false,
  slashQuery: '',
  skillActive: false,
  skillQuery: '',
  contextParts: [],
  selectedSlashCommand: null,
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function areContextPartsEqual(left: ChatContextPart[], right: ChatContextPart[]): boolean {
  if (left === right) {
    return true
  }
  if (left.length !== right.length) {
    return false
  }

  return left.every((leftPart, index) => {
    const rightPart = right[index]
    if (!rightPart || leftPart.type !== rightPart.type || leftPart.position !== rightPart.position) {
      return false
    }

    if (leftPart.type === 'data-cradle-skill') {
      return rightPart.type === 'data-cradle-skill'
        && leftPart.name === rightPart.name
        && leftPart.path === rightPart.path
        && leftPart.scope === rightPart.scope
        && leftPart.description === rightPart.description
    }

    if (rightPart.type !== 'data-cradle-plugin') {
      return false
    }

    const leftNativeMention = leftPart.nativeMention ?? null
    const rightNativeMention = rightPart.nativeMention ?? null
    const nativeMentionEqual = leftNativeMention === rightNativeMention
      || (
        leftNativeMention !== null
        && rightNativeMention !== null
        && leftNativeMention.name === rightNativeMention.name
        && leftNativeMention.path === rightNativeMention.path
      )

    return nativeMentionEqual
      && leftPart.provider === rightPart.provider
      && leftPart.pluginName === rightPart.pluginName
      && leftPart.displayName === rightPart.displayName
      && leftPart.description === rightPart.description
      && leftPart.iconUrl === rightPart.iconUrl
      && leftPart.routeSegment === rightPart.routeSegment
      && areStringArraysEqual(leftPart.mcpServers, rightPart.mcpServers)
      && leftPart.capabilities.length === rightPart.capabilities.length
      && leftPart.capabilities.every((capability, capabilityIndex) => {
        const rightCapability = rightPart.capabilities[capabilityIndex]
        return Boolean(rightCapability)
          && capability.id === rightCapability.id
          && capability.type === rightCapability.type
          && capability.layer === rightCapability.layer
          && capability.label === rightCapability.label
      })
  })
}

function areComposerStatesEqual(left: ComposerState, right: ComposerState): boolean {
  return left.inputValue === right.inputValue
    && left.mentionActive === right.mentionActive
    && left.mentionQuery === right.mentionQuery
    && left.slashActive === right.slashActive
    && left.slashQuery === right.slashQuery
    && left.skillActive === right.skillActive
    && left.skillQuery === right.skillQuery
    && left.selectedSlashCommand === right.selectedSlashCommand
    && areContextPartsEqual(left.contextParts, right.contextParts)
}

function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'input/changed':
      return areComposerStatesEqual(state, action.state) ? state : action.state
    case 'input/cleared':
      return { ...INITIAL_COMPOSER_STATE }
    case 'mention/closed':
      return { ...state, mentionActive: false }
    case 'mention/selected':
      return {
        ...state,
        mentionActive: false,
        mentionQuery: '',
        slashActive: false,
        slashQuery: '',
        skillActive: false,
        skillQuery: '',
      }
    case 'slash/closed':
      return { ...state, slashActive: false }
    case 'slash/selected':
      return {
        ...state,
        inputValue: action.inputValue,
        slashActive: false,
        slashQuery: '',
        mentionActive: false,
        mentionQuery: '',
        skillActive: false,
        skillQuery: '',
        selectedSlashCommand: action.command,
      }
    case 'skill/closed':
      return { ...state, skillActive: false }
    case 'skill/selected':
      return {
        ...state,
        mentionActive: false,
        mentionQuery: '',
        slashActive: false,
        slashQuery: '',
        skillActive: false,
        skillQuery: '',
        selectedSlashCommand: null,
      }
    case 'pickers/closed':
      return {
        ...state,
        mentionActive: false,
        slashActive: false,
        skillActive: false,
      }
    default:
      return state
  }
}

const TOKEN_CIRCLE_RADIUS = 7
const TOKEN_CIRCUMFERENCE = 2 * Math.PI * TOKEN_CIRCLE_RADIUS

function TokenProgress({
  tokens,
  contextWindow,
  sessionId,
  compactState,
}: {
  tokens: number
  contextWindow: number | null | undefined
  sessionId?: string | null
  compactState?: ChatRuntimeCompactUiSlotState | null
}) {
  const [open, setOpen] = useState(false)

  if (!tokens || tokens <= 0) {
    return null
  }
  const percent = contextWindow ? Math.min(1, tokens / contextWindow) : 0
  const offset = TOKEN_CIRCUMFERENCE * (1 - percent)
  const isWarning = percent > 0.7
  const isDanger = percent > 0.9
  const label = contextWindow
    ? `${formatTokenCount(tokens)} / ${formatTokenCount(contextWindow)} tokens`
    : `${formatTokenCount(tokens)} tokens`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-[background-color,color] duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Context usage: ${label}`}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="9" cy="9" r={TOKEN_CIRCLE_RADIUS} strokeWidth="2" className="stroke-muted" fill="none" />
            {contextWindow && (
              <circle
                cx="9"
                cy="9"
                r={TOKEN_CIRCLE_RADIUS}
                strokeWidth="2"
                fill="none"
                className={cn(
                  'transition-[stroke] duration-150',
                  isDanger ? 'stroke-destructive/70' : isWarning ? 'stroke-warning/70' : 'stroke-primary/50',
                )}
                strokeDasharray={TOKEN_CIRCUMFERENCE}
                strokeDashoffset={offset}
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={12} className="w-auto p-0 border-0 shadow-none ring-0 bg-transparent">
        <ContextUsageDetailPanel
          sessionId={sessionId ?? null}
          compactState={compactState}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

function ComposerSendIcon({
  isBangMode,
  isPlanMode,
  isSending,
}: {
  isBangMode?: boolean
  isPlanMode?: boolean
  isSending?: boolean
}) {
  if (isSending) {
    return <Spinner className="size-3" aria-hidden="true" />
  }

  const iconClassName = (active: boolean) => cn(
    'absolute inset-0 size-3.5 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
    active ? 'scale-100 opacity-100 blur-0' : 'scale-[0.25] opacity-0 blur-[4px]',
  )
  const showPlanIcon = Boolean(!isBangMode && isPlanMode)

  return (
    <span className="relative size-3.5" aria-hidden="true">
      <SendHorizonalIcon
        className={iconClassName(!isBangMode && !isPlanMode)}
      />
      <RouteIcon
        className={iconClassName(showPlanIcon)}
      />
      <SquareTerminalIcon
        className={iconClassName(Boolean(isBangMode))}
      />
    </span>
  )
}

function ComposerActions({
  actionsClassName,
  attachButtonClassName,
  attachIconClassName,
  contextBar,
  disabled,
  hasDraft,
  isBangMode,
  isPlanMode,
  isSending,
  isStreaming,
  onSend,
  onStop,
  sendDisabled,
  sendBlocked,
  attachButtonTestId,
  sendButtonClassName,
  sendButtonTestId,
  stopButtonTestId,
  attachmentController,
  sessionId,
  sessionTokens,
  sessionContextWindow,
  compactState,
  sendButtonAriaLabel,
}: {
  actionsClassName?: string
  attachButtonClassName?: string
  attachIconClassName?: string
  contextBar?: React.ReactNode
  disabled?: boolean
  hasDraft: boolean
  isBangMode?: boolean
  isPlanMode?: boolean
  isSending?: boolean
  isStreaming?: boolean
  onSend: () => void
  onStop?: () => void
  sendDisabled?: boolean
  sendBlocked?: boolean
  attachButtonTestId: string
  sendButtonClassName?: string
  sendButtonTestId: string
  stopButtonTestId: string
  attachmentController: ComposerAttachmentController | null
  sessionId?: string | null
  sessionTokens?: number
  sessionContextWindow?: number | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  sendButtonAriaLabel?: string
}) {
  const isPlanSendMode = Boolean(isPlanMode && !isBangMode)
  const sendButtonSize = isPlanSendMode ? 'xs' : 'icon-xs'
  const sendButtonLabel = isBangMode
    ? 'Run shell command'
    : isPlanSendMode
      ? 'Send planning request'
      : sendButtonAriaLabel
  const continuationButtonLabel = isBangMode
    ? 'Run shell command'
    : isPlanSendMode
      ? 'Send planning continuation'
      : (sendButtonAriaLabel ?? 'Send continuation')
  const sendButtonChrome = cn(
    sendButtonClassName,
    isPlanSendMode && [
      'min-w-14 gap-1 bg-amber-500 px-2 text-amber-950 hover:bg-amber-400',
      'focus-visible:border-amber-600 focus-visible:ring-amber-500/35',
      'dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300',
    ],
  )

  return (
    <div className={cn('flex items-center gap-1', actionsClassName)}>
      {contextBar}
      {attachmentController && (
        <ComposerAttachmentButton
          disabled={disabled}
          className={attachButtonClassName}
          iconClassName={attachIconClassName}
          onPickFiles={attachmentController.pickFiles}
          supportsAttachments={attachmentController.supportsAttachments}
          testId={attachButtonTestId}
        />
      )}
      {sessionTokens != null && sessionTokens > 0 && sessionContextWindow != null && sessionContextWindow > 0 && (
        <TokenProgress
          tokens={sessionTokens}
          contextWindow={sessionContextWindow}
          sessionId={sessionId}
          compactState={compactState}
        />
      )}
      {isStreaming && hasDraft && (
        <Button
          variant="outline"
          size={sendButtonSize}
          disabled={disabled || sendDisabled || sendBlocked}
          onClick={() => onSend()}
          aria-label={continuationButtonLabel}
          className={sendButtonChrome}
          data-testid={sendButtonTestId}
        >
          <ComposerSendIcon isBangMode={isBangMode} isPlanMode={isPlanMode} isSending={isSending} />
          {isPlanSendMode && <span className="text-[11px] font-semibold">Plan</span>}
        </Button>
      )}
      {isStreaming
        ? (
          <Button
            variant="default"
            size="icon-xs"
            onClick={onStop}
            aria-label="Stop generation"
            className={sendButtonClassName}
            data-testid={stopButtonTestId}
          >
            <SquareIcon className="size-3" aria-hidden="true" />
          </Button>
        )
        : (
          <Button
            variant="default"
            size={sendButtonSize}
            disabled={disabled || sendDisabled || sendBlocked || !hasDraft}
            onClick={() => onSend()}
            aria-label={sendButtonLabel ?? 'Send message'}
            className={sendButtonChrome}
            data-testid={sendButtonTestId}
          >
            <ComposerSendIcon isBangMode={isBangMode} isPlanMode={isPlanMode} isSending={isSending} />
            {isPlanSendMode && <span className="text-[11px] font-semibold">Plan</span>}
          </Button>
        )}
    </div>
  )
}

export function Composer({
  send,
  commands,
  attachments,
  runtimeSettings,
  slots,
  externalSignals,
  view,
  testIds,
  accessibility,
}: ComposerProps) {
  const {
    submit,
    submitInNewWindow,
    isStreaming,
    isSending,
    disabled,
    sendDisabled,
    allowEmptySend,
    onQuickQuestion,
  } = send
  const slashCommands = commands?.commands ?? EMPTY_SLASH_COMMANDS
  const onSlashCommandAction = commands?.runAction
  const supportsAttachments = attachments?.supportsAttachments
  const appendExternalFileParts = attachments?.appendFileParts
  const appendExternalFilePartsKey = attachments?.appendFilePartsKey
  const pendingAppshots = attachments?.pendingAppshots ?? []
  const onActionTargetElementChange = attachments?.onActionTargetElementChange
  const toolbar = slots?.toolbar
  const contextBar = slots?.contextBar
  const footer = slots?.footer
  const replaceText = externalSignals?.replaceText
  const replaceTextKey = externalSignals?.replaceTextKey
  const clearDraftKey = externalSignals?.clearDraftKey
  const suspendDraftPersistence = externalSignals?.suspendDraftPersistence ?? false
  const parentReplaceDraft = externalSignals?.replaceDraft
  const parentReplaceDraftKey = externalSignals?.replaceDraftKey
  const appendText = externalSignals?.appendText
  const appendTextKey = externalSignals?.appendTextKey

  // Per-surface draft persistence — restores draft on remount (e.g. tab switch)
  const surfaceId = view?.surfaceId
  const draftSync = useComposerDraftSync(surfaceId ?? '')
  // Parent-provided replaceDraft takes priority (e.g. queue item editing)
  const replaceDraft = parentReplaceDraft ?? (surfaceId ? draftSync.replaceDraft : undefined)
  const replaceDraftKey = parentReplaceDraftKey ?? (surfaceId ? draftSync.replaceDraftKey : 0)
  const {
    placeholder = 'Message...',
    availableFiles = EMPTY_FILES,
    searchFiles,
    availablePlugins = EMPTY_PLUGINS,
    searchPlugins,
    availableSkills = EMPTY_SKILLS,
    searchSkills,
    className,
    cardClassName,
    textareaClassName,
    textareaRows,
    inputCollapsed = false,
    attachmentListClassName,
    actionBarClassName,
    toolbarClassName,
    actionsClassName,
    attachButtonClassName,
    attachIconClassName,
    sendButtonClassName,
    onDraftChange,
    onDraftPartsChange,
    onFocusChange,
    sessionId,
    sessionTokens,
    sessionContextWindow,
    compactState,
  } = view ?? {}
  const {
    textareaAriaLabel = 'Message',
    sendButtonAriaLabel,
  } = accessibility ?? {}
  const [state, dispatch] = useReducer(composerReducer, INITIAL_COMPOSER_STATE)
  const stateRef = useRef(state)
  stateRef.current = state
  const [activeSlashOptionId, setActiveSlashOptionId] = useState<string | undefined>(undefined)
  const attachmentController = useComposerAttachments({ supportsAttachments })
  const composerAttachments = attachmentController.attachments
  const appendComposerFileParts = attachmentController.appendFileParts
  const clearComposerAttachments = attachmentController.clearAttachments
  const handleAttachmentFilesSelected = attachmentController.handleFilesSelected
  const handleAttachmentPaste = attachmentController.handlePaste
  const promptEditorRef = useRef<PromptEditorController>(null)
  const actionTargetRef = useRef<HTMLDivElement>(null)
  const setActionTargetElement = useCallback((element: HTMLDivElement | null) => {
    actionTargetRef.current = element
    onActionTargetElementChange?.(element)
  }, [onActionTargetElementChange])
  const visibleSlashCommands = useMemo(
    () => getVisibleSlashCommands(slashCommands, Boolean(onSlashCommandAction)),
    [onSlashCommandAction, slashCommands],
  )
  const slashPanelItems = useMemo(
    () => getSlashCommandPanelItems(visibleSlashCommands, state.slashQuery),
    [state.slashQuery, visibleSlashCommands],
  )
  const slashPanelHasResults = state.slashActive && slashPanelItems.length > 0
  const mentionItems = useMemo<MentionPickerItem[]>(() => [
    ...availablePlugins,
    ...availableFiles,
  ], [availableFiles, availablePlugins])
  const searchMentionItems = useCallback(async (query: string, signal?: AbortSignal): Promise<MentionPickerItem[]> => {
    const [plugins, files] = await Promise.all([
      searchPlugins ? searchPlugins(query, signal) : Promise.resolve(availablePlugins),
      searchFiles ? searchFiles(query, signal) : Promise.resolve(availableFiles),
    ])
    return [...plugins, ...files]
  }, [availableFiles, availablePlugins, searchFiles, searchPlugins])

  const mentionRangeRef = useRef<PromptEditorTriggerRange | null>(null)
  const slashRangeRef = useRef<PromptEditorTriggerRange | null>(null)
  const skillRangeRef = useRef<PromptEditorTriggerRange | null>(null)
  const activeSlashCommand = getActiveSlashCommand(state.inputValue, state.selectedSlashCommand, visibleSlashCommands)
  const slashCommandPrefix = activeSlashCommand ? getSlashCommandPrefix(activeSlashCommand) : ''
  const slashAwaitingRequiredArgument = activeSlashCommand
    ? isSlashCommandAwaitingRequiredArgument(state.inputValue, activeSlashCommand)
    : false
  const slashArgumentHint = activeSlashCommand?.argumentHint && (
    state.inputValue.replace(LEADING_HORIZONTAL_WHITESPACE_RE, '') === slashCommandPrefix
    || slashAwaitingRequiredArgument
  )
    ? activeSlashCommand.argumentHint
    : ''
  const actionTargetTestId = testIds?.actionTarget ?? 'chat-composer-action-target'
  const textareaTestId = testIds?.textarea ?? 'chat-composer-textarea'
  const fileInputTestId = testIds?.fileInput ?? 'chat-file-input'
  const attachButtonTestId = testIds?.attachButton ?? 'chat-attach-btn'
  const sendButtonTestId = testIds?.sendButton ?? 'chat-send-btn'
  const stopButtonTestId = testIds?.stopButton ?? 'chat-stop-btn'
  const hasVisibleInputPayload = !inputCollapsed && (
    Boolean(state.inputValue.trim())
    || attachmentController.hasAttachments
    || state.contextParts.length > 0
  )
  const hasDraft = hasVisibleInputPayload || Boolean(allowEmptySend)
  const bangCommandPreview = !inputCollapsed && !attachmentController.hasAttachments && state.contextParts.length === 0
    ? readBangCommandDraft(state.inputValue)
    : null
  const bangCommand = !inputCollapsed && !attachmentController.hasAttachments && state.contextParts.length === 0
    ? readBangCommand(state.inputValue)
    : null
  const isBangMode = bangCommandPreview !== null
  const sendBlocked = (isBangMode && bangCommand === null) || slashAwaitingRequiredArgument
  const effectiveDisabled = disabled || isSending
  const textareaRowsClassName = textareaRows === undefined
    ? undefined
    : textareaRowsClasses[textareaRows] ?? textareaRowsClasses[3]
  const runtimeInteractionMode = runtimeSettings?.settings.interactionMode
  const isPlanMode = runtimeInteractionMode === 'plan'
  const runtimeSettingsDisabled = runtimeSettings?.disabled ?? false
  const onRuntimeSettingsChange = runtimeSettings?.onChange

  const handleEditorChange = useCallback((snapshot: PromptEditorSnapshot) => {
    const currentState = stateRef.current
    const selectedSlashCommand = snapshot.trigger?.kind === 'slash'
      ? snapshot.trigger.selectedCommand
      : getActiveSlashCommand(snapshot.text, currentState.selectedSlashCommand, visibleSlashCommands)

    mentionRangeRef.current = snapshot.trigger?.kind === 'file' ? snapshot.trigger.range : null
    slashRangeRef.current = snapshot.trigger?.kind === 'slash' ? snapshot.trigger.range : null
    skillRangeRef.current = snapshot.trigger?.kind === 'skill' ? snapshot.trigger.range : null

    dispatch({
      type: 'input/changed',
      state: {
        ...currentState,
        inputValue: snapshot.text,
        contextParts: snapshot.contextParts,
        mentionActive: snapshot.trigger?.kind === 'file',
        mentionQuery: snapshot.trigger?.kind === 'file' ? snapshot.trigger.query : '',
        slashActive: snapshot.trigger?.kind === 'slash',
        slashQuery: snapshot.trigger?.kind === 'slash' ? snapshot.trigger.query : '',
        skillActive: snapshot.trigger?.kind === 'skill',
        skillQuery: snapshot.trigger?.kind === 'skill' ? snapshot.trigger.query : '',
        selectedSlashCommand,
      },
    })
  }, [visibleSlashCommands])

  const handleMentionSelect = useCallback((item: MentionPickerItem) => {
    const range = mentionRangeRef.current
    if (!range) {
      return
    }
    if (item.kind === 'plugin') {
      promptEditorRef.current?.insertPluginMention(item, range)
    }
    else {
      promptEditorRef.current?.insertFileMention(item, range)
    }
    dispatch({ type: 'mention/selected' })
  }, [])

  const handleMentionTabComplete = useCallback((item: MentionPickerItem) => {
    const range = mentionRangeRef.current
    if (!range) {
      return
    }
    if (item.kind === 'plugin') {
      promptEditorRef.current?.insertPluginMention(item, range)
      dispatch({ type: 'mention/selected' })
      return
    }
    promptEditorRef.current?.replaceFileTriggerWithText(item, range)
  }, [])

  const handleSkillSelect = useCallback((item: SkillMentionItem) => {
    const range = skillRangeRef.current
    if (!range) {
      return
    }
    promptEditorRef.current?.insertSkillMention(item, range)
    dispatch({ type: 'skill/selected' })
  }, [])

  const handleSlashCommandSelect = useCallback((command: ChatComposerSlashCommand) => {
    const currentState = stateRef.current
    const range = slashRangeRef.current ?? { from: 1, to: Math.max(1, currentState.inputValue.length + 1) }
    const inputSnapshot = currentState.inputValue

    if (command.action.kind === 'uiAction') {
      dispatch({ type: 'slash/selected', inputValue: currentState.inputValue, command: null })
      void (async () => {
        if (!onSlashCommandAction) {
          return
        }

        const readActionContext = (options?: ComposerActionContextOptions) => readComposerActionContext(actionTargetRef.current, options)
        const result = await onSlashCommandAction(command, readActionContext(), { readActionContext })
        if (result?.fileParts?.length) {
          appendComposerFileParts(result.fileParts)
        }
        if (typeof result?.insertText !== 'string') {
          return
        }

        const currentValue = promptEditorRef.current?.getText() ?? inputSnapshot
        if (currentValue !== inputSnapshot) {
          return
        }

        const next = replaceSlashTrigger(inputSnapshot, range.to - 1, range.from - 1, result.insertText)
        dispatch({ type: 'slash/selected', inputValue: next.value, command: null })
        promptEditorRef.current?.replaceRangeWithText(range, result.insertText)
      })()
      requestAnimationFrame(() => promptEditorRef.current?.focus())
      return
    }

    if (command.action.kind === 'submitText') {
      const submitText = command.action.text
      const hasComposerPayload = composerAttachments.length > 0 || currentState.contextParts.length > 0
      if (disabled || isSending || sendDisabled || (command.action.requiresEmptyComposer && hasComposerPayload)) {
        requestAnimationFrame(() => promptEditorRef.current?.focus())
        return
      }

      dispatch({ type: 'slash/selected', inputValue: currentState.inputValue, command: null })
      submitAndClearDraft({
        appendFileParts: appendComposerFileParts,
        clearAttachments: clearComposerAttachments,
        contextParts: [],
        dispatch,
        files: [],
        promptEditor: promptEditorRef.current,
        submit,
        text: submitText,
      })
      requestAnimationFrame(() => promptEditorRef.current?.focus())
      return
    }

    const insertText = command.action.text
    const next = replaceSlashTrigger(currentState.inputValue, range.to - 1, range.from - 1, insertText)
    dispatch({ type: 'slash/selected', inputValue: next.value, command })
    promptEditorRef.current?.replaceRangeWithText(range, insertText)
  }, [
    appendComposerFileParts,
    clearComposerAttachments,
    composerAttachments,
    disabled,
    isSending,
    onSlashCommandAction,
    sendDisabled,
    submit,
  ])

  const handleSend = useCallback((
    options?: { invertContinuationMode?: boolean },
    submitHandler: ComposerSendHandler = submit,
  ) => {
    const currentState = stateRef.current
    const editorText = inputCollapsed ? '' : promptEditorRef.current?.getText() ?? currentState.inputValue
    const contextParts = inputCollapsed ? [] : promptEditorRef.current?.getContextParts() ?? currentState.contextParts
    const text = editorText.trim()
    const files = inputCollapsed ? [] : composerAttachments
    if (disabled || isSending || sendDisabled || sendBlocked) {
      return
    }
    if (!allowEmptySend && !text && files.length === 0 && contextParts.length === 0) {
      return
    }
    if (inputCollapsed) {
      let result: ComposerSendResult | Promise<ComposerSendResult>
      try {
        result = options
          ? submitHandler('', [], [], options)
          : submitHandler('', [], [])
      }
      catch (error) {
        reportComposerSubmitError(error)
        return
      }
      if (isComposerSendPromise(result)) {
        void result.catch(reportComposerSubmitError)
      }
      return
    }

    if (onQuickQuestion) {
      const btwMatch = text.match(BTW_QUICK_QUESTION_RE)
      if (btwMatch?.[1]) {
        const question = btwMatch[1].trim()
        onQuickQuestion(question)
        dispatch({ type: 'input/cleared' })
        promptEditorRef.current?.setText('')
        return
      }
    }

    submitAndClearDraft({
      appendFileParts: appendComposerFileParts,
      clearAttachments: clearComposerAttachments,
      contextParts,
      dispatch,
      files,
      options,
      promptEditor: promptEditorRef.current,
      submit: submitHandler,
      text,
    })
    // Clear persisted draft on send
    if (surfaceId) {
      useComposerDraftStore.getState().deleteDraft(surfaceId)
    }
  }, [
    allowEmptySend,
    appendComposerFileParts,
    clearComposerAttachments,
    composerAttachments,
    disabled,
    inputCollapsed,
    isSending,
    onQuickQuestion,
    sendBlocked,
    sendDisabled,
    submit,
    surfaceId,
  ])

  const toggleRuntimeInteractionMode = useCallback(() => {
    if (!runtimeInteractionMode || runtimeSettingsDisabled || !onRuntimeSettingsChange) {
      return false
    }

    onRuntimeSettingsChange({
      interactionMode: runtimeInteractionMode === 'plan' ? 'default' : 'plan',
    })
    return true
  }, [onRuntimeSettingsChange, runtimeInteractionMode, runtimeSettingsDisabled])

  const handlePaste = useCallback((event: ClipboardEvent) => {
    handleAttachmentPaste(event as unknown as React.ClipboardEvent<HTMLElement>)
  }, [handleAttachmentPaste])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't interfere with IME composition (e.g. Chinese input)
    if (e.isComposing) {
      return
    }

    if (e.key === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (toggleRuntimeInteractionMode()) {
        e.preventDefault()
        e.stopPropagation()
      }
      return
    }

    // If a picker is active, let it handle Enter/Escape/arrows/Tab.
    const currentState = stateRef.current
    const currentSlashPanelHasResults = currentState.slashActive
      && getSlashCommandPanelItems(visibleSlashCommands, currentState.slashQuery).length > 0
    if (currentState.mentionActive || currentState.skillActive || currentSlashPanelHasResults) {
      if (['Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) {
        return
      }
    }

    if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (submitInNewWindow) {
        handleSend(undefined, submitInNewWindow)
        return
      }
      handleSend({ invertContinuationMode: true })
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, submitInNewWindow, toggleRuntimeInteractionMode, visibleSlashCommands])

  // Append externally-provided text (e.g. from DnD drop on parent container)
  useEffect(() => {
    if (!appendText) {
      return
    }
    promptEditorRef.current?.appendText(appendText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendTextKey])

  useEffect(() => {
    if (typeof replaceText !== 'string') {
      return
    }
    promptEditorRef.current?.setText(replaceText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceTextKey])

  useEffect(() => {
    if (clearDraftKey === undefined) {
      return
    }
    clearComposerAttachments()
    promptEditorRef.current?.clear()
    dispatch({ type: 'input/cleared' })
    if (surfaceId) {
      useComposerDraftStore.getState().deleteDraft(surfaceId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearDraftKey])

  useEffect(() => {
    if (!replaceDraft) {
      return
    }
    promptEditorRef.current?.setDraft(replaceDraft.text, replaceDraft.contextParts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaceDraftKey])

  useEffect(() => {
    onDraftChange?.(state.inputValue)
    onDraftPartsChange?.(state.inputValue, state.contextParts)
    if (!suspendDraftPersistence) {
      draftSync?.handleDraftPartsChange(state.inputValue, state.contextParts)
    }
  }, [onDraftChange, onDraftPartsChange, draftSync, state.inputValue, state.contextParts, suspendDraftPersistence])

  // Append externally-injected file parts (e.g. from Cmd+Cmd appshot hotkey)
  useLayoutEffect(() => {
    if (!appendExternalFileParts || appendExternalFileParts.length === 0) {
      return
    }
    attachmentController.appendFileParts(appendExternalFileParts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendExternalFilePartsKey])

  const handleEditorFocusChange = useCallback((focused: boolean) => {
    onFocusChange?.(focused)
    if (!focused) {
      window.setTimeout(() => {
        dispatch({ type: 'pickers/closed' })
      }, 150)
    }
  }, [onFocusChange])

  const handleEditorDrop = useCallback((event: DragEvent) => {
    // First, check if this is a workspace file drag (internal drag from file tree)
    const path = event.dataTransfer ? readWorkspaceFileDragText(event.dataTransfer) : ''
    if (path) {
      event.preventDefault()
      event.stopPropagation()
      promptEditorRef.current?.appendText(path)
      return true
    }

    // In local mode, handle external file drops as attachments
    if (isLocalMode() && event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      event.preventDefault()
      event.stopPropagation()
      void handleAttachmentFilesSelected({
        target: { files: event.dataTransfer.files, value: '' },
      } as ChangeEvent<HTMLInputElement>)
      return true
    }

    return false
  }, [handleAttachmentFilesSelected])

  const handleMentionClose = useCallback(() => {
    dispatch({ type: 'mention/closed' })
  }, [])

  const handleSkillClose = useCallback(() => {
    dispatch({ type: 'skill/closed' })
  }, [])

  const handleSlashClose = useCallback(() => {
    dispatch({ type: 'slash/closed' })
  }, [])

  return (
    <div className={cn('relative w-full z-10', className)}>
      {/* Mention panel — pops up above the composer */}
      <MentionPanel
        items={mentionItems}
        query={state.mentionQuery}
        searchItems={searchMentionItems}
        onSelect={handleMentionSelect}
        onTabComplete={handleMentionTabComplete}
        onClose={handleMentionClose}
        visible={!inputCollapsed && state.mentionActive}
      />
      <SkillMentionPanel
        items={availableSkills}
        query={state.skillQuery}
        searchItems={searchSkills}
        onSelect={handleSkillSelect}
        onClose={handleSkillClose}
        visible={!inputCollapsed && state.skillActive}
      />
      <SlashCommandPanel
        commands={visibleSlashCommands}
        listboxId={CHAT_SLASH_COMMAND_LISTBOX_ID}
        onActiveOptionIdChange={setActiveSlashOptionId}
        query={state.slashQuery}
        onSelect={handleSlashCommandSelect}
        onClose={handleSlashClose}
        visible={!inputCollapsed && state.slashActive}
      />

      {/* Input card — modern clean style, no border-t separator */}
      <div
        ref={setActionTargetElement}
        className={cn(
          'rounded-xl bg-background shadow-md border border-border focus-within:ring-0 focus-within:border-ring/40 transition-[border-color,box-shadow] duration-150',
          cardClassName,
          isPlanMode && [
            'border-amber-400/70 shadow-[0_0_0_1px_rgba(251,191,36,0.18),0_18px_40px_-30px_rgba(245,158,11,0.72)]',
            'focus-within:border-amber-400/90 focus-within:shadow-[0_0_0_1px_rgba(251,191,36,0.34),0_22px_44px_-32px_rgba(245,158,11,0.80)]',
            'dark:border-amber-300/55 dark:shadow-[0_0_0_1px_rgba(252,211,77,0.16),0_18px_40px_-30px_rgba(251,191,36,0.48)]',
            'dark:focus-within:border-amber-300/80 dark:focus-within:shadow-[0_0_0_1px_rgba(252,211,77,0.26),0_22px_44px_-32px_rgba(251,191,36,0.56)]',
          ],
          footer && [
            'border-0 bg-transparent shadow-none ring-0',
            'focus-within:border-transparent focus-within:shadow-none',
          ],
        )}
        data-testid={actionTargetTestId}
        data-composer-action-target
      >
        <div
          className={cn(
            footer && [
              'relative z-10 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-[0_1px_2px_rgb(0_0_0_/_0.04),0_8px_24px_-20px_rgb(0_0_0_/_0.28)]',
              'focus-within:border-ring/50',
            ],
          )}
        >
          {!inputCollapsed && (
            <ComposerAttachmentInput
              fileInputRef={attachmentController.fileInputRef}
              onFilesSelected={attachmentController.handleFilesSelected}
              supportsAttachments={attachmentController.supportsAttachments}
              testId={fileInputTestId}
            />
          )}
          {/* Prompt editor */}
          <div className={cn('relative', inputCollapsed && 'hidden')}>
            {slashArgumentHint && (
              <div
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-3.5 pb-2 text-sm text-transparent',
                  textareaRowsClassName ?? 'min-h-20 max-h-60',
                )}
                data-testid="slash-argument-hint"
              >
                <span>{state.inputValue}</span>
                <span className="text-muted-foreground/45">{slashArgumentHint}</span>
              </div>
            )}
            <PromptEditor
              ref={promptEditorRef}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onDrop={handleEditorDrop}
              onChange={handleEditorChange}
              onFocusChange={handleEditorFocusChange}
              placeholder={placeholder}
              disabled={effectiveDisabled}
              ariaLabel={textareaAriaLabel}
              ariaControls={slashPanelHasResults ? CHAT_SLASH_COMMAND_LISTBOX_ID : undefined}
              ariaExpanded={state.slashActive}
              ariaActiveDescendant={slashPanelHasResults ? activeSlashOptionId : undefined}
              testId={textareaTestId}
              className={cn(textareaRowsClassName, textareaClassName)}
              selectedSlashCommand={state.selectedSlashCommand}
              slashCommands={visibleSlashCommands}
            />
          </div>

          {!inputCollapsed && (
            <ComposerAttachmentList
              attachments={attachmentController.attachments}
              onRemove={attachmentController.removeAttachment}
              pendingAppshots={pendingAppshots}
              className={attachmentListClassName}
            />
          )}

          {/* Action bar — subtle, blends with the card */}
          <div
            className={cn(
              'flex items-center justify-between gap-2 px-3 py-2',
              actionBarClassName,
            )}
          >
            {/* Left: custom toolbar from parent */}
            <div className={cn('min-w-0 flex-1', toolbarClassName)}>
              <div className="grid min-w-0 overflow-hidden">
                <div
                  className={cn(
                    'col-start-1 row-start-1 flex min-w-0 items-center gap-1 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                    isBangMode && 'pointer-events-none translate-y-2 opacity-0 blur-[3px]',
                  )}
                >
                  {toolbar}
                </div>
                <div
                  className={cn(
                    'pointer-events-none col-start-1 row-start-1 flex min-w-0 items-center transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
                    isBangMode
                      ? 'translate-y-0 opacity-100 blur-0'
                      : 'translate-y-2 opacity-0 blur-[3px]',
                  )}
                >
                  <div
                    className="inline-flex h-6 max-w-64 items-center gap-1.5 rounded-md bg-muted px-2 font-mono text-[11px] text-muted-foreground"
                    data-testid="chat-bang-command-indicator"
                  >
                    <SquareTerminalIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
                    <span className="truncate">{bangCommandPreview}</span>
                    {sendBlocked && <span className="ml-0.5 h-3 w-1 rounded-full bg-muted-foreground/60" aria-hidden="true" />}
                  </div>
                </div>
              </div>
            </div>

            <ComposerActions
              actionsClassName={actionsClassName}
              attachButtonClassName={attachButtonClassName}
              attachIconClassName={attachIconClassName}
              sessionId={sessionId}
              sessionTokens={sessionTokens}
              sessionContextWindow={sessionContextWindow}
              compactState={compactState}
              contextBar={contextBar}
              disabled={effectiveDisabled}
              hasDraft={hasDraft}
              isBangMode={isBangMode}
              isPlanMode={isPlanMode}
              isSending={isSending}
              isStreaming={isStreaming}
              attachmentController={inputCollapsed ? null : attachmentController}
              onSend={handleSend}
              onStop={send.stop}
              sendDisabled={sendDisabled}
              sendBlocked={sendBlocked}
              attachButtonTestId={attachButtonTestId}
              sendButtonAriaLabel={sendButtonAriaLabel}
              sendButtonClassName={sendButtonClassName}
              sendButtonTestId={sendButtonTestId}
              stopButtonTestId={stopButtonTestId}
            />
          </div>
        </div>
        {footer && (
          <div className=" relative -mt-4 flex min-h-11 min-w-0 items-center rounded-b-2xl bg-background/90 backdrop-blur-lg text-[13px] shadow-sm">
            <div className="bg-muted/45 h-full w-full px-2.5 pb-1 pt-5 ">
              {footer}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
