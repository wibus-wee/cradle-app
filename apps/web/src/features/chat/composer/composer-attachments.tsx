import type { FileUIPart } from 'ai'
import {
  FileLine as FileIcon,
  AttachmentLine as PaperclipIcon,
  CloseLine as XIcon
} from '@mingcute/react'
import { m } from 'motion/react'
import type { ChangeEvent, RefObject } from 'react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'

import { AppshotAttachmentCard } from './appshot-attachment'
import { readCradleAppshotMetadata } from './appshot-attachment-model'

const APPSHOT_FALLBACK_HEIGHT = 140

interface ComposerAttachmentInputProps {
  fileInputRef: RefObject<HTMLInputElement | null>
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  supportsAttachments: boolean
  testId?: string
}

interface ComposerAttachmentButtonProps {
  disabled?: boolean
  className?: string
  iconClassName?: string
  onPickFiles: () => void
  supportsAttachments: boolean
  testId?: string
}

interface ComposerAttachmentListProps {
  attachments: FileUIPart[]
  onRemove: (index: number) => void
  pendingAppshots?: PendingAppshotAttachment[]
  className?: string
}

export interface PendingAppshotAttachment {
  requestId: string
  transitionSnapshotHeight: number | null
  transitionSnapshotHeightResolved: boolean
  transitionSpringDampingFraction: number | null
  transitionSpringResponse: number | null
}

export function ComposerAttachmentInput({
  fileInputRef,
  onFilesSelected,
  supportsAttachments,
  testId = 'chat-file-input',
}: ComposerAttachmentInputProps) {
  return (
    <Input
      ref={fileInputRef}
      type="file"
      multiple
      accept={supportsAttachments ? undefined : ''}
      className="hidden"
      tabIndex={-1}
      aria-label="Attach files"
      onChange={onFilesSelected}
      data-testid={testId}
    />
  )
}

export function ComposerAttachmentButton({
  disabled,
  className,
  iconClassName,
  onPickFiles,
  supportsAttachments,
  testId = 'chat-attach-btn',
}: ComposerAttachmentButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled || !supportsAttachments}
          onClick={onPickFiles}
          aria-label="Attach files"
          className={className}
          data-testid={testId}
        >
          <PaperclipIcon className={cn('size-3.5', iconClassName)} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[11px]">
        {supportsAttachments ? 'Attach files' : 'Current model does not accept file input'}
      </TooltipContent>
    </Tooltip>
  )
}

export function ComposerAttachmentList({
  attachments,
  onRemove,
  pendingAppshots = [],
  className,
}: ComposerAttachmentListProps) {
  if (attachments.length === 0 && pendingAppshots.length === 0) {
    return null
  }

  return (
    <div
      className={cn('border-t border-border/40 px-3 py-2', className)}
      data-composer-attachments-container
    >
      <div
        className="w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-composer-attachments-row
      >
        <div className="flex min-w-max items-end gap-2">
          {pendingAppshots.map(pending => (
            <PendingAppshotSlot key={pending.requestId} pending={pending} />
          ))}
          {attachments.map((attachment, index) => {
            const label = attachment.filename ?? attachment.mediaType
            const isImage = attachment.mediaType.startsWith('image/')
            const isFileUrl = attachment.url.startsWith('file://')
            const appshotMetadata = readCradleAppshotMetadata(attachment)
            if (appshotMetadata) {
              return (
                <AppshotAttachmentCard
                  key={`${attachment.url}-${attachment.filename ?? attachment.mediaType}`}
                  variant="composer"
                  metadata={appshotMetadata}
                  onRemove={() => onRemove(index)}
                />
              )
            }
            return (
              <m.div
                layout
                key={`${attachment.url}-${attachment.filename ?? attachment.mediaType}`}
                className="flex max-w-64 items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
                data-chat-attachment-chip
                data-chat-image-attachment-chip={isImage && !isFileUrl ? true : undefined}
                data-chat-file-path-chip={isFileUrl ? true : undefined}
                data-testid="chat-attachment-chip"
                initial={{ opacity: 0, scale: 0.98, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
              >
                {isImage && !isFileUrl
                  ? (
                      <img
                        src={attachment.url}
                        alt={label}
                        className="size-10 shrink-0 rounded-[4px] object-cover shadow-[inset_0_0_0_1px_rgba(0,0,0,0.10)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
                        data-testid="chat-attachment-image-preview"
                      />
                    )
                  : <FileIcon className="size-3.5 shrink-0" aria-hidden="true" />}
                <span className="min-w-0 truncate">{label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="-mr-1 size-5"
                  onClick={() => onRemove(index)}
                  aria-label={`Remove ${label}`}
                  data-testid="chat-remove-attachment-btn"
                >
                  <XIcon className="size-3" aria-hidden="true" />
                </Button>
              </m.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function PendingAppshotSlot({ pending }: { pending: PendingAppshotAttachment }) {
  const height = pending.transitionSnapshotHeightResolved
      ? (pending.transitionSnapshotHeight ?? APPSHOT_FALLBACK_HEIGHT)
      : 0
  const transition = {
    type: 'spring' as const,
    visualDuration: pending.transitionSpringResponse ?? 0.35,
    bounce: 1 - (pending.transitionSpringDampingFraction ?? 0.73),
    delay: 0.15,
  }

  return (
    <m.div
      aria-hidden="true"
      className="relative shrink-0 overflow-hidden rounded-2xl"
      data-pending-appshot-capture
      data-pending-appshot-capture-height={height}
      data-pending-appshot-capture-request-id={pending.requestId}
      initial={{ height: 0, marginRight: -8, width: 0 }}
      animate={{ height, marginRight: 0, width: 232 }}
      transition={{ height: transition, marginRight: transition, width: transition }}
    />
  )
}
