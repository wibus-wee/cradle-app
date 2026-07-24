import {
  Chat1Line as MessageCircleIcon,
  ClipboardLine as ClipboardIcon,
  DownloadLine as DownloadIcon,
  PicLine as ImageDownIcon,
} from '@mingcute/react'
import type { UIMessage } from 'ai'
import { domToPng } from 'modern-screenshot'
import { useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import { chatSelectors, useChatStore } from '~/store/chat'

import { MessageBubble } from '../rendering/message-bubble'
import {
  readShareExportTitle,
  readShareMessagePreview,
} from './chat-read-surface-projection'

type ExportScope = 'all' | 'selected'

interface ChatShareExportProps {
  sessionId: string | null
  disabled?: boolean
}

const SHARE_SURFACE_WIDTH = 960
const EXPORT_SCALE = 2
const MAX_CANVAS_SIZE = 32_767
const FILENAME_TIMESTAMP_RE = /[:.]/g
const TRANSPARENT_COLOR_RE = /^rgba\(0,\s*0,\s*0,\s*0\)$/i
const EMPTY_MESSAGES: UIMessage[] = []

function formatRole(role: UIMessage['role']): string {
  switch (role) {
    case 'assistant':
      return 'Assistant'
    case 'user':
      return 'User'
    case 'system':
      return 'System'
    default:
      return 'Message'
  }
}

function createExportFilename(sessionId: string | null): string {
  const sessionPart = sessionId ? sessionId.slice(0, 8) : 'draft'
  const timestamp = new Date()
    .toISOString()
    .replace(FILENAME_TIMESTAMP_RE, '-')
    .replace('T', '-')
    .slice(0, 19)
  return `cradle-session-${sessionPart}-${timestamp}.png`
}

function readExportBackgroundColor(node: HTMLElement): string {
  const nodeColor = window.getComputedStyle(node).backgroundColor
  if (nodeColor && nodeColor !== 'transparent' && !TRANSPARENT_COLOR_RE.test(nodeColor)) {
    return nodeColor
  }

  const bodyColor = window.getComputedStyle(document.body).backgroundColor
  if (bodyColor && bodyColor !== 'transparent' && !TRANSPARENT_COLOR_RE.test(bodyColor)) {
    return bodyColor
  }

  return '#ffffff'
}

function downloadDataUrl(filename: string, dataUrl: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}

async function copyPngDataUrl(dataUrl: string): Promise<void> {
  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) {
    throw new Error('PNG clipboard export is not supported in this browser.')
  }

  const response = await fetch(dataUrl)
  const blob = await response.blob()
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob,
    }),
  ])
}

export function ChatShareExport({ sessionId, disabled }: ChatShareExportProps) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<ExportScope>('all')
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(() => new Set())
  const [busyAction, setBusyAction] = useState<'download' | 'copy' | null>(null)
  const exportSurfaceRef = useRef<HTMLDivElement>(null)
  const messageCount = useChatStore(chatSelectors.messageCount(sessionId ?? ''), (a, b) => a === b)
  const messages = useChatStore(open ? chatSelectors.messages(sessionId ?? '') : () => EMPTY_MESSAGES)

  const exportMessages = (() => {
    if (scope === 'all') {
      return messages
    }
    return messages.filter(message => selectedMessageIds.has(message.id))
  })()

  const selectedCount = selectedMessageIds.size
  const canExport = exportMessages.length > 0 && !busyAction
  const selectedCountLabel = `${selectedCount} selected`
  const exportTitle = readShareExportTitle(exportMessages)

  const toggleMessage = (messageId: string) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current)
      if (next.has(messageId)) {
        next.delete(messageId)
      }
      else {
        next.add(messageId)
      }
      return next
    })
  }

  const selectAllMessages = () => {
    setSelectedMessageIds(new Set(messages.map(message => message.id)))
  }

  const clearSelectedMessages = () => {
    setSelectedMessageIds(new Set())
  }

  const renderPngDataUrl = async () => {
    const node = exportSurfaceRef.current
    if (!node) {
      throw new Error('Export preview is not ready.')
    }

    await document.fonts.ready
    return domToPng(node, {
      width: SHARE_SURFACE_WIDTH,
      backgroundColor: readExportBackgroundColor(node),
      scale: EXPORT_SCALE,
      maximumCanvasSize: MAX_CANVAS_SIZE,
      fetch: {
        requestInit: { cache: 'force-cache' },
      },
    })
  }

  const handleDownload = async () => {
    if (!canExport) {
      return
    }

    setBusyAction('download')
    try {
      const dataUrl = await renderPngDataUrl()
      downloadDataUrl(createExportFilename(sessionId), dataUrl)
      toastManager.add({
        type: 'success',
        title: 'Conversation PNG exported',
        description: `${exportMessages.length} message${exportMessages.length === 1 ? '' : 's'} saved.`,
      })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Conversation export failed',
        description: error instanceof Error ? error.message : 'Unknown export error.',
      })
    }
    finally {
      setBusyAction(null)
    }
  }

  const handleCopy = async () => {
    if (!canExport) {
      return
    }

    setBusyAction('copy')
    try {
      const dataUrl = await renderPngDataUrl()
      await copyPngDataUrl(dataUrl)
      toastManager.add({
        type: 'success',
        title: 'Conversation PNG copied',
        description: `${exportMessages.length} message${exportMessages.length === 1 ? '' : 's'} copied.`,
      })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: 'Conversation copy failed',
        description: error instanceof Error ? error.message : 'Unknown clipboard error.',
      })
    }
    finally {
      setBusyAction(null)
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled || messageCount === 0}
            onClick={() => setOpen(true)}
            aria-label="Export conversation PNG"
            data-testid="chat-share-export-open"
            className="text-muted-foreground/70 hover:text-foreground"
          >
            <ImageDownIcon className="size-4" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[11px]">
          Export PNG
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] w-[min(1280px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none" showCloseButton={false}>
          <DialogHeader className="border-b border-border/60 px-4 py-3">
            <DialogTitle>Export conversation PNG</DialogTitle>
            <DialogDescription>
              Render the current session as a Cradle-styled share image.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 grid-cols-[320px_minmax(0,1fr)]">
            <aside className="min-h-0 border-r border-border/60 bg-muted/25">
              <div className="space-y-3 p-3">
                <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
                  <Button
                    type="button"
                    variant={scope === 'all' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setScope('all')}
                    className="h-7 rounded-md text-xs"
                  >
                    All
                  </Button>
                  <Button
                    type="button"
                    variant={scope === 'selected' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setScope('selected')}
                    className="h-7 rounded-md text-xs"
                  >
                    Selected
                  </Button>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {selectedCountLabel}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="xs" onClick={selectAllMessages}>
                      Select all
                    </Button>
                    <Button type="button" variant="ghost" size="xs" onClick={clearSelectedMessages}>
                      Clear
                    </Button>
                  </div>
                </div>
              </div>

              <ScrollArea className="h-[min(560px,calc(100vh-14rem))] px-3 pb-3">
                <div className="space-y-1">
                  {messages.map((message, index) => {
                    const checked = selectedMessageIds.has(message.id)
                    return (
                      <label
                        key={message.id}
                        className={cn(
                          'flex min-h-12 cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-left transition-[background-color,color]',
                          checked ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleMessage(message.id)}
                          aria-label={`Select message ${index + 1}`}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-medium">
                            {`${index + 1}. ${formatRole(message.role)}`}
                          </span>
                          <span className="line-clamp-2 block text-[11px] leading-4">
                            {readShareMessagePreview(message)}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </ScrollArea>
            </aside>

            <main className="min-h-0 bg-background">
              <ScrollArea className="h-[min(680px,calc(100vh-10rem))]">
                <div className="flex justify-center p-6">
                  <div
                    ref={exportSurfaceRef}
                    className="w-[960px] overflow-hidden rounded-xl bg-background text-foreground shadow-[0_24px_80px_rgba(0,0,0,0.14)] ring-1 ring-foreground/10"
                    data-testid="chat-share-export-surface"
                  >
                    <div className="grid h-11 grid-cols-[120px_minmax(0,1fr)_120px] items-center border-b border-border/60 bg-sidebar px-3">
                      <div className="text-sm font-medium text-muted-foreground">
                        Cradle
                      </div>

                      <div className="mx-auto flex min-w-0 max-w-[620px] items-center gap-2 rounded-lg bg-background px-3 py-1.5 text-center text-sm font-medium text-foreground">
                        <MessageCircleIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">
                          {exportTitle}
                        </span>
                      </div>
                      <div aria-hidden="true" />
                    </div>

                    <div className="bg-background px-16 py-12">
                      <div className="mx-auto max-w-[760px] space-y-5">
                        {exportMessages.length > 0
                          ? exportMessages.map(message => (
                              <MessageBubble
                                key={message.id}
                                message={message}
                                isStreaming={false}
                                presentation="export"
                              />
                            ))
                          : (
                              <div className="rounded-lg bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground">
                                Select at least one message to export.
                              </div>
                            )}
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </main>
          </div>

          <DialogFooter variant="bare" className="border-t border-border/60 px-4 py-3">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={Boolean(busyAction)}>
              Close
            </Button>
            <Button type="button" variant="outline" onClick={handleCopy} disabled={!canExport}>
              {busyAction === 'copy'
                ? <Spinner className="size-3.5" aria-hidden="true" />
                : <ClipboardIcon className="size-3.5" aria-hidden="true" />}
              Copy PNG
            </Button>
            <Button type="button" onClick={handleDownload} disabled={!canExport}>
              {busyAction === 'download'
                ? <Spinner className="size-3.5" aria-hidden="true" />
                : <DownloadIcon className="size-3.5" aria-hidden="true" />}
              Download PNG
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
