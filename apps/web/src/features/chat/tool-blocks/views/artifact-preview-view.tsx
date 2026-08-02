import {
  Dashboard2Line as ArtifactIcon,
  FullscreenLine as Maximize2Icon,
} from '@mingcute/react'
import type { KeyboardEvent, MouseEvent } from 'react'

import { Button } from '~/components/ui/button'

export interface ArtifactOpenInput {
  sessionId: string
  artifactId: string
  toolCallId: string
  title: string
  source: string
  revision: number
}

export interface ArtifactPreviewViewProps {
  sessionId: string
  artifactId: string
  toolCallId: string
  title: string
  source: string
  revision: number
  onOpen?: (input: ArtifactOpenInput) => void
}

/** Props-only Artifact card in chat. Panel ownership is supplied through onOpen. */
export function ArtifactPreviewView({
  sessionId,
  artifactId,
  toolCallId,
  title,
  source,
  revision,
  onOpen,
}: ArtifactPreviewViewProps) {
  const openArtifact = () => onOpen?.({
    sessionId,
    artifactId,
    toolCallId,
    title,
    source,
    revision,
  })

  const handlePreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null
    if (target?.closest('a, button')) {
      return
    }
    openArtifact()
  }

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openArtifact()
    }
  }

  const lineCount = source.split(/\r?\n/).length

  return (
    <div
      className="group/artifact relative overflow-hidden rounded-md border border-border/70 bg-background/85 shadow-xs transition-[border-color,box-shadow] duration-150 hover:border-border hover:shadow-sm"
      data-testid="chat-artifact-preview"
      role="button"
      tabIndex={0}
      aria-label={`Open artifact ${title}`}
      onClick={handlePreviewClick}
      onKeyDown={handlePreviewKeyDown}
    >
      <div className="flex h-8 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <ArtifactIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
          <span className="min-w-0 truncate text-xs font-medium text-foreground/80">
            {title || 'Artifact'}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-text-tertiary">
            rev
            {' '}
            {revision}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0 text-muted-foreground/70 opacity-70 transition-[opacity,scale] duration-150 hover:text-foreground group-hover/artifact:opacity-100 active:scale-[0.96]"
          aria-label="Open artifact in panel"
          onClick={openArtifact}
        >
          <Maximize2Icon className="size-3" aria-hidden="true" />
        </Button>
      </div>
      <div className="space-y-1 px-3 py-2.5">
        <div className="text-[11px] tabular-nums text-text-tertiary">
          {artifactId}
          <span className="mx-1.5 text-border">·</span>
          {lineCount}
          {' '}
          lines JSX
        </div>
        <pre className="max-h-28 overflow-hidden whitespace-pre-wrap break-all font-mono text-[10px] leading-4 text-text-secondary" style={{
            maskImage:
              'linear-gradient(to bottom, black 0%, black calc(100% - 20px), transparent)',
          }}
        >
          {source.slice(0, 600)}
        </pre>
      </div>
    </div>
  )
}
