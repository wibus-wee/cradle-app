import {
  CloseLine as XIcon,
  PicLine as ImageIcon,
  Rows3Line as Rows3Icon,
} from '@mingcute/react'
import { m } from 'motion/react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { useState } from 'react'

import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { cn } from '~/lib/cn'

import type { CradleAppshotMetadata } from './appshot-attachment-model'

interface AppshotAttachmentCardProps {
  variant: 'composer' | 'thread'
  metadata: CradleAppshotMetadata
  onRemove?: () => void
}

const APPSHOT_CARD_WIDTH = 232
const APPSHOT_THREAD_IMAGE_CANVAS_WIDTH = 256
const APPSHOT_THREAD_IMAGE_INLINE_PADDING = 12
const APPSHOT_FALLBACK_HEIGHT = 140
const APPSHOT_COMPOSER_IDENTITY_HEIGHT = 21

export function AppshotAttachmentCard({
  variant,
  metadata,
  onRemove,
}: AppshotAttachmentCardProps) {
  const title = metadata.windowTitle ?? metadata.appName ?? 'AppShot'
  const appName = metadata.appName ?? 'AppShot'
  const accessibilityText = metadata.axTree.trim()
  const snapshotHeight = metadata.transitionSnapshotHeight ?? APPSHOT_FALLBACK_HEIGHT
  const composerImageDataUrl = metadata.transitionSnapshotDataUrl
  const [threadImageSize, setThreadImageSize] = useState<{ height: number, width: number } | null>(null)
  const threadImageHeight = readThreadImageHeight(threadImageSize)
  const hasAccessibilityText = accessibilityText.length > 0
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewMode, setPreviewMode] = useState<'visual' | 'text'>('visual')
  const openPreview = () => {
    setPreviewMode('visual')
    setPreviewOpen(true)
  }
  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }
    event.preventDefault()
    openPreview()
  }
  const handleRemoveClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onRemove?.()
  }

  return (
    <>
      <m.div
        layout
        className={cn(
          'group/appshot relative flex w-[232px] shrink-0 flex-col items-center overflow-visible transition-colors duration-200',
          'cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
          onRemove ? 'hover:bg-muted/45' : 'hover:bg-muted/25',
          variant === 'thread' && 'rounded-2xl pb-2 pt-[10px]',
        )}
        style={{ height: variant === 'composer' ? snapshotHeight + APPSHOT_COMPOSER_IDENTITY_HEIGHT : undefined }}
        role="button"
        tabIndex={0}
        aria-label={title}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
        onClick={openPreview}
        onKeyDown={handleCardKeyDown}
        data-chat-attachment-chip={variant === 'composer' ? true : undefined}
        data-chat-appshot-card
        data-testid="chat-appshot-card"
      >
        <AppshotImageFrame
          alt={title}
          appIconDataUrl={metadata.appIconDataUrl}
          imageDataUrl={variant === 'composer' ? composerImageDataUrl : metadata.imageDataUrl}
          imageHeight={APPSHOT_FALLBACK_HEIGHT}
          renderedImageHeight={variant === 'thread' ? threadImageHeight : snapshotHeight}
          slotWidth={APPSHOT_CARD_WIDTH}
          visualWidth={variant === 'thread' ? APPSHOT_THREAD_IMAGE_CANVAS_WIDTH : APPSHOT_CARD_WIDTH}
          imageInlinePadding={variant === 'thread' ? APPSHOT_THREAD_IMAGE_INLINE_PADDING : 0}
          usesThreadTreatment={variant === 'thread'}
          onImageSize={setThreadImageSize}
        />
        <div
          className={cn(
            'mt-1 h-[17px] w-full truncate text-center font-medium leading-[17px] text-foreground',
            variant === 'composer' ? 'px-2 text-[12px] text-muted-foreground' : 'text-[13px]',
          )}
        >
          {variant === 'composer' ? appName : title}
        </div>
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="pointer-events-none absolute right-1.5 top-1.5 z-20 size-6 bg-background/95 opacity-0 shadow-sm backdrop-blur transition-opacity group-hover/appshot:pointer-events-auto group-hover/appshot:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            onClick={handleRemoveClick}
            aria-label={`Remove ${title}`}
            data-testid="chat-remove-attachment-btn"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </Button>
        )}
        <span className="sr-only" data-testid="chat-appshot-identity">{title}</span>
      </m.div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent
          className="grid h-[min(86vh,48rem)] w-[min(90vw,72rem)] max-w-full grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[min(90vw,72rem)]"
          showCloseButton
          data-testid="chat-appshot-preview-dialog"
        >
          <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 px-4 py-3 pr-12">
            <DialogTitle className="min-w-0 truncate text-sm">{title}</DialogTitle>
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border p-0.5">
              <Button
                type="button"
                variant={previewMode === 'visual' ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => setPreviewMode('visual')}
                aria-pressed={previewMode === 'visual'}
                data-testid="chat-appshot-preview-visual"
              >
                <ImageIcon className="size-3.5" aria-hidden="true" />
                Screenshot
              </Button>
              <Button
                type="button"
                variant={previewMode === 'text' ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => setPreviewMode('text')}
                disabled={!hasAccessibilityText}
                aria-pressed={previewMode === 'text'}
                data-testid="chat-appshot-preview-toggle"
              >
                <Rows3Icon className="size-3.5" aria-hidden="true" />
                AX Tree
              </Button>
            </div>
          </DialogHeader>
          {previewMode === 'text' && hasAccessibilityText
            ? (
                <div className="min-h-0 overflow-y-auto bg-background px-5 py-4">
                  <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                    {accessibilityText}
                  </pre>
                </div>
              )
            : (
                <div className="flex min-h-0 items-center justify-center bg-background p-4">
                  <img
                    src={metadata.imageDataUrl}
                    alt={title}
                    className="max-h-full max-w-full object-contain"
                    draggable={false}
                    data-testid="chat-appshot-preview-image"
                  />
                </div>
              )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function AppshotImageFrame({
  alt,
  appIconDataUrl,
  imageDataUrl,
  imageHeight,
  renderedImageHeight = imageHeight,
  imageInlinePadding = 0,
  onImageSize,
  slotWidth,
  usesThreadTreatment = false,
  visualWidth,
}: {
  alt: string
  appIconDataUrl: string | null
  imageDataUrl: string | null
  imageHeight: number
  renderedImageHeight?: number
  imageInlinePadding?: number
  onImageSize?: (size: { height: number, width: number }) => void
  slotWidth: number
  usesThreadTreatment?: boolean
  visualWidth: number
}) {
  return (
    <div
      className="relative flex items-end justify-center overflow-visible"
      style={{ height: imageHeight, width: slotWidth }}
    >
      <div
        className="relative flex shrink-0 items-end justify-center"
        style={{
          filter: usesThreadTreatment ? 'drop-shadow(0px 10px 5px rgba(0, 0, 0, 0.3))' : undefined,
          height: renderedImageHeight,
          paddingInline: imageInlinePadding,
          width: visualWidth,
          WebkitMaskImage: usesThreadTreatment
            ? 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.21) 79%, rgba(0,0,0,0) 100%)'
            : undefined,
          maskImage: usesThreadTreatment
            ? 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.21) 79%, rgba(0,0,0,0) 100%)'
            : undefined,
        }}
      >
        {imageDataUrl
          ? (
              <img
                src={imageDataUrl}
                alt={alt}
                className="max-h-full max-w-full object-contain"
                loading="lazy"
                draggable={false}
                onLoad={(event) => {
                  onImageSize?.({
                    height: event.currentTarget.naturalHeight,
                    width: event.currentTarget.naturalWidth,
                  })
                }}
                data-testid="chat-appshot-image"
              />
            )
          : (
              <div
                className="h-full w-full rounded-xl border border-dashed border-border/70 bg-muted/35"
                data-testid="chat-appshot-empty-snapshot"
              />
            )}
      </div>
      <AppshotAppIcon appIconDataUrl={appIconDataUrl} />
    </div>
  )
}

function AppshotAppIcon({ appIconDataUrl }: { appIconDataUrl: string | null }) {
  if (!appIconDataUrl) {
    return null
  }

  return (
    <img
      src={appIconDataUrl}
      alt=""
      aria-hidden="true"
      className="absolute bottom-0 left-1/2 size-6 -translate-x-1/2 object-contain"
      draggable={false}
      data-testid="chat-appshot-app-icon"
    />
  )
}

function readThreadImageHeight(size: { height: number, width: number } | null): number {
  if (!size || size.height <= 0 || size.width <= 0) {
    return APPSHOT_FALLBACK_HEIGHT
  }
  const scale = Math.min(APPSHOT_CARD_WIDTH / size.width, APPSHOT_FALLBACK_HEIGHT / size.height)
  return size.height * scale
}
