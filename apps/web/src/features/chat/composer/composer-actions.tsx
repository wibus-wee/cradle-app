import {
  DownSmallLine as ChevronDownIcon,
  RouteLine as RouteIcon,
  SendPlaneLine as SendHorizonalIcon,
  SquareLine as SquareIcon,
  TerminalBoxLine as SquareTerminalIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { ButtonGroup } from '~/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import { formatTokenCount } from '~/lib/number-format'

import type { ChatRuntimeCompactUiSlotState } from '../capabilities/chat-capabilities'
import { ContextUsageDetailPanel } from '../context/context-usage-detail-panel'
import type { ComposerAttachmentController } from './composer-attachment-state'
import { ComposerAttachmentButton } from './composer-attachments'

export interface ComposerSendVariantAction {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
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
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 cursor-pointer rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Context usage: ${label}`}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            style={{ transform: 'rotate(-90deg)' }}
          >
            <circle
              cx="9"
              cy="9"
              r={TOKEN_CIRCLE_RADIUS}
              strokeWidth="2"
              className="stroke-muted"
              fill="none"
            />
            {contextWindow && (
              <circle
                cx="9"
                cy="9"
                r={TOKEN_CIRCLE_RADIUS}
                strokeWidth="2"
                fill="none"
                className={cn(
                  'transition-[stroke] duration-150',
                  isDanger
                    ? 'stroke-destructive/70'
                    : isWarning
                      ? 'stroke-warning/70'
                      : 'stroke-primary/50',
                )}
                strokeDasharray={TOKEN_CIRCUMFERENCE}
                strokeDashoffset={offset}
                strokeLinecap="round"
              />
            )}
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={12}
        className="w-auto border-0 bg-transparent p-0 shadow-none ring-0"
      >
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

  const iconClassName = (active: boolean) =>
    cn(
      'absolute inset-0 size-3.5 transition-[opacity,transform,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
      active ? 'scale-100 opacity-100 blur-0' : 'scale-[0.25] opacity-0 blur-[4px]',
    )
  const showPlanIcon = Boolean(!isBangMode && isPlanMode)

  return (
    <span className="relative size-3.5" aria-hidden="true">
      <SendHorizonalIcon className={iconClassName(!isBangMode && !isPlanMode)} />
      <RouteIcon className={iconClassName(showPlanIcon)} />
      <SquareTerminalIcon className={iconClassName(Boolean(isBangMode))} />
    </span>
  )
}

export function ComposerActions({
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
  usesLightOcr,
  sessionId,
  sessionTokens,
  sessionContextWindow,
  compactState,
  sendButtonAriaLabel,
  sendButtonText,
  sendVariants,
}: {
  actionsClassName?: string
  attachButtonClassName?: string
  attachIconClassName?: string
  contextBar?: ReactNode
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
  usesLightOcr?: boolean
  sessionId?: string | null
  sessionTokens?: number
  sessionContextWindow?: number | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  sendButtonAriaLabel?: string
  sendButtonText?: string
  sendVariants?: ComposerSendVariantAction[]
}) {
  const isPlanSendMode = Boolean(isPlanMode && !isBangMode)
  const showCustomSendText = !!sendButtonText && !isBangMode && !isPlanSendMode
  const sendButtonSize = isPlanSendMode || showCustomSendText ? 'xs' : 'icon-xs'
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
    showCustomSendText && 'min-w-20 gap-1.5 px-2.5',
  )
  const sendButton = (
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
      {showCustomSendText && <span className="text-[11px] font-semibold">{sendButtonText}</span>}
    </Button>
  )
  const sendVariantsAvailable
    = !!sendVariants && sendVariants.length > 0 && !isBangMode && !isPlanSendMode
  const sendButtonNode
    = sendVariantsAvailable && sendVariants
? (
      <ButtonGroup>
        {sendButton}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="default"
              size="icon-xs"
              disabled={disabled || sendDisabled || sendBlocked || !hasDraft}
              aria-label={sendButtonLabel ? `${sendButtonLabel} options` : 'Send options'}
              className={cn(sendButtonClassName, 'px-1 mx-0')}
              data-testid={`${sendButtonTestId}-variants`}
            >
              <ChevronDownIcon className="size-3" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {sendVariants.map(variant => (
              <DropdownMenuItem
                key={variant.id}
                onSelect={() => variant.onSelect()}
                disabled={disabled || sendDisabled || sendBlocked || !hasDraft}
              >
                {variant.icon}
                <span>{variant.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    )
: (
      sendButton
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
          usesLightOcr={usesLightOcr}
          testId={attachButtonTestId}
        />
      )}
      {sessionTokens != null
        && sessionTokens > 0
        && sessionContextWindow != null
        && sessionContextWindow > 0 && (
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
        sendButtonNode
      )}
    </div>
  )
}
