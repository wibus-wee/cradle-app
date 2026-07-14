import { StaticRender } from '@cradle/streamdown'
import {
  AddLine as PlusIcon,
  FileUnknownLine as FileQuestionIcon,
  PicLine as ImageIcon,
} from '@mingcute/react'
import { useEffect, useRef, useState } from 'react'
import type { BundledLanguage } from 'shiki'

import {
  DARK_THEME,
  getHighlighter,
  LIGHT_THEME,
  loadLanguage,
} from '~/components/editor/shiki-highlighter'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

import { FileLineCommentBox } from './file-line-comment-box'
import type { WorkspaceFileInfo } from './use-workspace-file-content'
import {
  buildWorkspaceFilePdfUrl,
  buildWorkspaceFileRawUrl,
  useWorkspaceFileContent,
  useWorkspaceFileInfo,
} from './use-workspace-file-content'
import { getShikiLanguage } from './workspace-file-language'
import { WorkspacePdfPreview } from './workspace-pdf-preview'

interface WorkspaceFilePreviewProps {
  workspaceId: string
  path: string
  onOpenEditor: (path: string) => void
  onAddLineComment?: (input: {
    workspaceId: string
    path: string
    lineNumber: number
    comment: string
  }) => void
}

export function WorkspaceFilePreview({
  workspaceId,
  path,
  onOpenEditor,
  onAddLineComment,
}: WorkspaceFilePreviewProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const infoQuery = useWorkspaceFileInfo(workspaceId, path)
  const info = infoQuery.data
  const canOpenTextEditor = info?.previewKind === 'text' || info?.previewKind === 'markdown'

  useEffect(() => {
    panelRef.current?.focus()
  }, [path])

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onDoubleClick={() => {
        if (canOpenTextEditor) {
          onOpenEditor(path)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && canOpenTextEditor) {
          event.preventDefault()
          onOpenEditor(path)
        }
      }}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background outline-none"
      data-testid="workspace-file-preview"
    >
      <div className="min-h-0 flex-1 overflow-y-auto bg-background/80">
        {infoQuery.isLoading && (
          <div className="flex h-32 items-center justify-center">
            <Spinner className="size-4 !text-muted-foreground/50" aria-hidden="true" />
          </div>
        )}
        {infoQuery.isError && (
          <div className="flex h-32 items-center justify-center px-6 text-center">
            <p className="text-sm text-muted-foreground">Unable to read this file.</p>
          </div>
        )}
        {info && (
          <WorkspaceFilePreviewContent
            workspaceId={workspaceId}
            path={path}
            info={info}
            onAddLineComment={onAddLineComment}
          />
        )}
      </div>
    </div>
  )
}

function WorkspaceFilePreviewContent({
  workspaceId,
  path,
  info,
  onAddLineComment,
}: {
  workspaceId: string
  path: string
  info: WorkspaceFileInfo
  onAddLineComment?: WorkspaceFilePreviewProps['onAddLineComment']
}) {
  if (info.previewKind === 'markdown') {
    return <TextBackedPreview workspaceId={workspaceId} path={path} kind="markdown" />
  }

  if (info.previewKind === 'text') {
    return (
      <TextBackedPreview
        workspaceId={workspaceId}
        path={path}
        kind="code"
        onAddLineComment={onAddLineComment}
      />
    )
  }

  if (info.previewKind === 'image') {
    return <ImagePreview src={buildWorkspaceFileRawUrl(workspaceId, path)} info={info} />
  }

  if (info.previewKind === 'pdf') {
    return <WorkspacePdfPreview url={buildWorkspaceFileRawUrl(workspaceId, path)} title={path} />
  }

  if (info.previewKind === 'office') {
    return <WorkspacePdfPreview url={buildWorkspaceFilePdfUrl(workspaceId, path)} title={path} />
  }

  return <UnsupportedPreview info={info} />
}

function TextBackedPreview({
  workspaceId,
  path,
  kind,
  onAddLineComment,
}: {
  workspaceId: string
  path: string
  kind: 'markdown' | 'code'
  onAddLineComment?: WorkspaceFilePreviewProps['onAddLineComment']
}) {
  const query = useWorkspaceFileContent(workspaceId, path)
  const content = query.data?.content

  if (query.isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner className="size-4 !text-muted-foreground/50" aria-hidden="true" />
      </div>
    )
  }

  if (query.isError || content === null || content === undefined) {
    return (
      <div className="flex h-32 items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">Unable to preview this file as text.</p>
      </div>
    )
  }

  return kind === 'markdown'
? (
    <MarkdownPreview content={content} />
  )
: (
    <CodePreview
      workspaceId={workspaceId}
      path={path}
      content={content}
      onAddLineComment={onAddLineComment}
    />
  )
}

function ImagePreview({ src, info }: { src: string, info: WorkspaceFileInfo }) {
  const [naturalSize, setNaturalSize] = useState<{ width: number, height: number } | null>(null)

  return (
    <div className="flex min-h-full flex-col bg-fill/30">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-3 text-[11px] text-muted-foreground">
        <ImageIcon className="size-3.5" aria-hidden="true" />
        <span className="min-w-0 truncate font-mono">{info.name}</span>
        {naturalSize && (
          <span className="ml-auto shrink-0 tabular-nums">
            {naturalSize.width}
{' '}
x
{naturalSize.height}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
        <img
          src={src}
          alt={info.name}
          onLoad={(event) => {
            setNaturalSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }}
          className="max-h-full max-w-full rounded object-contain shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_10px_28px_rgba(0,0,0,0.14)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_10px_28px_rgba(0,0,0,0.28)]"
        />
      </div>
    </div>
  )
}

function UnsupportedPreview({ info }: { info: WorkspaceFileInfo }) {
  return (
    <div className="flex h-40 items-center justify-center px-6 text-center">
      <div className="flex max-w-md flex-col items-center gap-2">
        <FileQuestionIcon className="size-5 !text-muted-foreground/70" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No preview is available for this file type.</p>
        <p className="font-mono text-[11px] text-muted-foreground/80">{info.mimeType}</p>
      </div>
    </div>
  )
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="streamdown-root px-5 py-4 text-sm leading-relaxed">
      <StaticRender content={content} />
    </div>
  )
}

function CodePreview({
  workspaceId,
  path,
  content,
  onAddLineComment,
}: {
  workspaceId: string
  path: string
  content: string
  onAddLineComment?: WorkspaceFilePreviewProps['onAddLineComment']
}) {
  const [html, setHtml] = useState('')
  const [failed, setFailed] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredLine, setHoveredLine] = useState<{
    lineNumber: number
    top: number
    height: number
  } | null>(null)
  const [activeLine, setActiveLine] = useState<{
    lineNumber: number
    top: number
    height: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    setHtml('')
    setFailed(false)

    async function renderHighlightedCode() {
      const language = getShikiLanguage(path)
      const loaded = await loadLanguage(language)
      const highlighter = await getHighlighter()
      const lang = loaded ? language : 'plaintext'
      const highlighted = highlighter.codeToHtml(content, {
        lang: lang as BundledLanguage,
        themes: { dark: DARK_THEME, light: LIGHT_THEME },
      })
      if (!cancelled) {
        setHtml(highlighted)
      }
    }

    renderHighlightedCode().catch(() => {
      if (!cancelled) {
        setFailed(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [content, path])

  return (
    <div
      ref={containerRef}
      className={cn(
        'tool-call-code-highlight relative max-h-[calc(100vh-8rem)] overflow-auto p-0 text-[12px] leading-relaxed',
        '[&_.shiki]:!m-0 [&_.shiki]:!bg-transparent [&_.shiki]:!p-4 [&_.shiki]:font-mono [&_.shiki]:text-[12px] [&_.shiki]:leading-relaxed',
      )}
      data-wrap="false"
      onMouseMove={(event) => {
        if (!onAddLineComment || activeLine || event.buttons !== 0) {
          return
        }
        const line
          = event.target instanceof Element ? event.target.closest<HTMLElement>('.line') : null
        const container = containerRef.current
        if (!line || !container?.contains(line)) {
          setHoveredLine(null)
          return
        }
        const lines = Array.from(line.parentElement?.querySelectorAll(':scope > .line') ?? [])
        const lineNumber = lines.indexOf(line) + 1
        const lineRect = line.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        setHoveredLine({
          lineNumber,
          top: lineRect.top - containerRect.top + container.scrollTop,
          height: lineRect.height,
        })
      }}
      onMouseLeave={() => setHoveredLine(null)}
    >
      {html && !failed && (
        // Shiki generates escaped token markup from plain text file content.
        // eslint-disable-next-line react-dom/no-dangerously-set-innerhtml
        <div dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {(!html || failed) && (
        <pre className="m-0 overflow-auto p-4 font-mono text-[12px] leading-relaxed text-foreground">
          <code>{content}</code>
        </pre>
      )}
      {onAddLineComment && hoveredLine && !activeLine && (
        <Button
          type="button"
          variant="secondary"
          size="icon-xs"
          className="absolute right-2 z-10 size-6 rounded-full text-[var(--color-accent-scope)] shadow-[var(--shadow-xs)]"
          style={{ top: hoveredLine.top + Math.max(0, (hoveredLine.height - 24) / 2) }}
          aria-label={`Comment on line ${hoveredLine.lineNumber}`}
          onClick={() => setActiveLine(hoveredLine)}
        >
          <PlusIcon className="size-3.5" aria-hidden="true" />
        </Button>
      )}
      {onAddLineComment && activeLine && (
        <div
          style={{
            position: 'absolute',
            insetInline: 0,
            top: activeLine.top + activeLine.height + 4,
          }}
        >
          <FileLineCommentBox
            lineNumber={activeLine.lineNumber}
            onCancel={() => setActiveLine(null)}
            onSubmit={(comment) => {
              onAddLineComment({ workspaceId, path, lineNumber: activeLine.lineNumber, comment })
              setActiveLine(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
