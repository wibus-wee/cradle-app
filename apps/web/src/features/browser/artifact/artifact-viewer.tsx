import { ArtifactActionProvider } from '@cradle/artifact'
import type { ErrorInfo, ReactNode } from 'react'
import { Component, useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import { requestArtifactPrompt } from './artifact-action-bridge'
import { ArtifactCompileError, compileArtifactSource } from './artifact-compiler'

export interface ArtifactViewerProps {
  sessionId: string
  artifactId: string
  title: string
  source: string
  revision: number
  /** When true, show the JSX source editor alongside the preview. */
  showSource?: boolean
}

type ViewMode = 'preview' | 'source'

export function ArtifactViewer({
  sessionId,
  artifactId,
  title,
  source,
  revision,
  showSource = true,
}: ArtifactViewerProps) {
  const [mode, setMode] = useState<ViewMode>('preview')
  const compiled = useMemo(() => {
    try {
      return { ok: true as const, module: compileArtifactSource(source) }
    }
    catch (error) {
      const message = error instanceof ArtifactCompileError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error)
      return { ok: false as const, error: message }
    }
  }, [source])

  const actionValue = useMemo(() => ({
    runPrompt: (prompt: string) => {
      requestArtifactPrompt({ sessionId, prompt })
    },
  }), [sessionId])

  return (
    <div className="absolute inset-0 flex flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-foreground">{title}</div>
          <div className="truncate text-[10px] tabular-nums text-text-tertiary">
            {artifactId}
            <span className="mx-1.5 text-border">·</span>
            rev
            {' '}
            {revision}
          </div>
        </div>
        {showSource
          ? (
            <div className="flex shrink-0 items-center gap-1 rounded-md bg-muted p-0.5">
              <ModeButton active={mode === 'preview'} onClick={() => setMode('preview')}>
                Preview
              </ModeButton>
              <ModeButton active={mode === 'source'} onClick={() => setMode('source')}>
                Source
              </ModeButton>
            </div>
          )
          : null}
      </div>

      <div className="relative min-h-0 flex-1">
        {mode === 'source'
          ? (
            <pre className="absolute inset-0 overflow-auto bg-background p-4 font-mono text-[11px] leading-5 text-text-secondary">
              {source}
            </pre>
          )
          : compiled.ok
            ? (
              <ArtifactActionProvider value={actionValue}>
                <ArtifactErrorBoundary resetKey={`${artifactId}:${revision}`}>
                  <compiled.module.default />
                </ArtifactErrorBoundary>
              </ArtifactActionProvider>
            )
            : (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="max-w-lg rounded-md border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-[12px] leading-5 text-foreground">
                  <div className="mb-1 font-medium">Artifact failed to compile</div>
                  <div className="text-text-secondary">{compiled.error}</div>
                </div>
              </div>
            )}
      </div>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={onClick}
      className={cn(
        'h-6 rounded-md px-2 text-[11px]',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-text-secondary hover:text-foreground',
      )}
    >
      {children}
    </Button>
  )
}

interface ArtifactErrorBoundaryProps {
  resetKey: string
  children: ReactNode
}

interface ArtifactErrorBoundaryState {
  error: Error | null
}

class ArtifactErrorBoundary extends Component<ArtifactErrorBoundaryProps, ArtifactErrorBoundaryState> {
  state: ArtifactErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ArtifactErrorBoundaryState {
    return { error }
  }

  componentDidUpdate(prevProps: ArtifactErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[artifact] render error', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-lg rounded-md border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-[12px] leading-5 text-foreground">
            <div className="mb-1 font-medium">Artifact crashed while rendering</div>
            <div className="text-text-secondary">{this.state.error.message}</div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
