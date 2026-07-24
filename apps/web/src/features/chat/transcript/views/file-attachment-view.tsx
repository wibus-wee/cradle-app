import { FileLine as FileIcon, PicLine as ImageIcon } from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import { AppshotAttachmentCard } from '../../composer/appshot-attachment'
import { readCradleAppshotMetadata } from '../../composer/appshot-attachment-model'
import type { FileMessagePart } from '../../rendering/chat-render-plan'

const FILE_ATTACHMENT_CLASS = 'my-1 block w-full min-w-0 max-w-full overflow-hidden rounded-md border border-border/60 bg-background/60'

export interface FileAttachmentViewProps {
  part: FileMessagePart
  onClick?: () => void
}

export function FileAttachmentView({ part, onClick }: FileAttachmentViewProps) {
  const label = part.filename ?? part.mediaType
  const isImage = part.mediaType.startsWith('image/')
  const appshotMetadata = readCradleAppshotMetadata(part)
  if (appshotMetadata) { return <AppshotAttachmentCard variant="thread" metadata={appshotMetadata} /> }

  const content = (
<>
{isImage && <img src={part.url} alt={label} className="h-auto max-h-48 w-full max-w-full object-cover" loading="lazy" data-testid="chat-file-attachment-image" />}
<div className="flex min-w-0 items-center gap-2 px-2.5 py-2 text-xs">
{isImage ? <ImageIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" /> : <FileIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />}
<div className="min-w-0 flex-1">
<div className="truncate font-medium text-foreground">{label}</div>
<div className="truncate text-[11px] text-muted-foreground">{part.mediaType}</div>
</div>
</div>
</>
)

  if (isImage && onClick) { return <Button type="button" variant="ghost" className={cn(FILE_ATTACHMENT_CLASS, 'h-auto justify-start p-0 text-left whitespace-normal transition-opacity hover:opacity-80')} data-testid="chat-file-attachment" onClick={onClick} aria-label={`Preview ${label}`}>{content}</Button> }
  return <div className={FILE_ATTACHMENT_CLASS} data-testid="chat-file-attachment">{content}</div>
}
