import { ArtifactActionProvider } from '@cradle/artifact'
import type { ErrorInfo, ReactNode } from 'react'
import { Component, useEffect, useMemo, useState } from 'react'

import { Button } from '~/components/ui/button'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'

import { requestArtifactPrompt } from './artifact-action-bridge'
import { ArtifactCompileError, compileArtifactSource } from './artifact-compiler'
import { getChatArtifact } from './chat-artifacts-api'

export interface ArtifactViewerProps {
  sessionId: string
  artifactId: string
  title: string
  /** Optional snapshot from the tool result / tab open. Prefer server fetch when available. */
  source?: string
  revision: number
  /** When true, show the JSX source editor alongside the preview. */
  showSource?: boolean
  /**
   * Fetch latest revision from the chat-artifacts API.
   * Disable in Storybook / offline fixtures that only supply `source`.
   */
  refreshFromServer?: boolean
}

type ViewMode = 'preview' | 'source'

export function ArtifactViewer({
  sessionId,
  artifactId,
  title,
  source = '',
  revision,
  showSource = true,
  refreshFromServer = true,
}: ArtifactViewerProps) {
  const [mode, setMode] = useState<ViewMode>('preview')
  const [liveTitle, setLiveTitle] = useState(title)
  const [liveSource, setLiveSource] = useState(source)
  const [liveRevision, setLiveRevision] = useState(revision)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    setLiveTitle(title)
    if (source.trim()) {
      setLiveSource(source)
    }
    setLiveRevision(revision)
  }, [title, source, revision])

  useEffect(() => {
    if (!refreshFromServer || !sessionId || !artifactId) {
      return
    }
    const controller = new AbortController()
    setFetching(true)
    setFetchError(null)
    void getChatArtifact(sessionId, artifactId, controller.signal)
      .then((record) => {
        setLiveTitle(record.title)
        setLiveSource(record.source)
        setLiveRevision(record.revision)
        setFetching(false)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return
        }
        setFetching(false)
        // Keep any prop snapshot; only surface a hard error when we have nothing to render.
        if (!source.trim()) {
          setFetchError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      controller.abort()
    }
  }, [sessionId, artifactId, refreshFromServer, revision, source])

  const compiled = useMemo(() => {
    if (!liveSource.trim()) {
      return { ok: false as const, error: null as string | null, empty: true as const }
    }
    try {
      return { ok: true as const, module: compileArtifactSource(liveSource), empty: false as const }
    }
    catch (error) {
      const message = error instanceof ArtifactCompileError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error)
      return { ok: false as const, error: message, empty: false as const }
    }
  }, [liveSource])

  const actionValue = useMemo(() => ({
    runPrompt: (prompt: string) => {
      const ok = requestArtifactPrompt({ sessionId, prompt })
      if (!ok) {
        toastManager.add({
          type: 'error',
          title: 'Could not send Artifact action — chat session is not ready',
        })
      }
      return ok
    },
  }), [sessionId])

  return (
    <div className="absolute inset-0 flex flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-foreground">{liveTitle}</div>
          <div className="truncate text-[10px] tabular-nums text-text-tertiary">
            {artifactId}
            <span className="mx-1.5 text-border">·</span>
            rev
            {' '}
            {liveRevision}
            {fetching
              ? (
                <>
                  <span className="mx-1.5 text-border">·</span>
                  loading
                </>
              )
              : null}
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
              {liveSource || (fetching ? '// Loading latest revision…' : '// No source loaded')}
            </pre>
          )
          : fetchError && !liveSource.trim()
            ? (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="max-w-lg rounded-md border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-[12px] leading-5 text-foreground">
                  <div className="mb-1 font-medium">Failed to load Artifact</div>
                  <div className="text-text-secondary">{fetchError}</div>
                </div>
              </div>
            )
            : compiled.empty
              ? (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-[12px] text-text-tertiary">
                  {fetching ? 'Loading Artifact…' : 'No Artifact source yet'}
                </div>
              )
              : compiled.ok
                ? (
                  <ArtifactActionProvider value={actionValue}>
                    <ArtifactErrorBoundary resetKey={`${artifactId}:${liveRevision}`}>
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
