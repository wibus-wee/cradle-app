import { renderMermaidSVG } from 'beautiful-mermaid'
import * as React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.2
const COPY_RESET_MS = 1500

let officialMermaidInitialized = false
let officialMermaidRenderSequence = 0

interface MermaidDiagramProps {
  code: string
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(2))))
}

function createMermaidSvg(code: string): { svg: string, error: string | null } {
  try {
    return {
      svg: renderMermaidSVG(code, {
        bg: 'var(--sd-mermaid-bg)',
        fg: 'var(--sd-mermaid-fg)',
        line: 'var(--sd-mermaid-line)',
        accent: 'var(--sd-mermaid-accent)',
        muted: 'var(--sd-mermaid-muted)',
        surface: 'var(--sd-mermaid-surface)',
        border: 'var(--sd-mermaid-border)',
        font: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
        padding: 28,
        transparent: true,
        interactive: true,
      }),
      error: null,
    }
  }
  catch (error) {
    return {
      svg: '',
      error: error instanceof Error ? error.message : 'Unable to render Mermaid diagram.',
    }
  }
}

async function renderOfficialMermaidSvg(code: string): Promise<string> {
  const mermaid = (await import('mermaid')).default
  if (!officialMermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        background: 'transparent',
        primaryColor: 'var(--sd-mermaid-surface)',
        primaryTextColor: 'var(--sd-mermaid-fg)',
        primaryBorderColor: 'var(--sd-mermaid-border)',
        lineColor: 'var(--sd-mermaid-line)',
        secondaryColor: 'var(--sd-mermaid-surface)',
        tertiaryColor: 'var(--sd-mermaid-bg)',
        fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
      },
    })
    officialMermaidInitialized = true
  }

  const renderId = `sd-mermaid-${Date.now().toString(36)}-${(officialMermaidRenderSequence++).toString(36)}`
  const result = await mermaid.render(renderId, code)
  return result.svg
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H3v5" />
      <path d="M3 3l7 7" />
      <path d="M16 3h5v5" />
      <path d="M21 3l-7 7" />
      <path d="M8 21H3v-5" />
      <path d="M3 21l7-7" />
      <path d="M16 21h5v-5" />
      <path d="M21 21l-7-7" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

interface MermaidControlsProps {
  copied: boolean
  expanded: boolean
  zoom: number
  onCopy: () => void
  onZoomOut: () => void
  onZoomIn: () => void
  onReset: () => void
  onToggleExpanded: () => void
}

function MermaidControls({
  copied,
  expanded,
  zoom,
  onCopy,
  onZoomOut,
  onZoomIn,
  onReset,
  onToggleExpanded,
}: MermaidControlsProps) {
  return (
    <div className="sd-mermaid-controls" onClick={event => event.stopPropagation()}>
      <button type="button" className="sd-mermaid-control" onClick={onZoomOut} aria-label="Zoom out Mermaid diagram" disabled={zoom <= MIN_ZOOM}>
        <MinusIcon />
      </button>
      <button type="button" className="sd-mermaid-control sd-mermaid-control--text" onClick={onReset} aria-label="Reset Mermaid zoom">
        {Math.round(zoom * 100)}
        %
      </button>
      <button type="button" className="sd-mermaid-control" onClick={onZoomIn} aria-label="Zoom in Mermaid diagram" disabled={zoom >= MAX_ZOOM}>
        <PlusIcon />
      </button>
      <button type="button" className="sd-mermaid-control" onClick={onReset} aria-label="Reset Mermaid diagram">
        <ResetIcon />
      </button>
      <button type="button" className="sd-mermaid-control" onClick={onCopy} aria-label={copied ? 'Copied Mermaid source' : 'Copy Mermaid source'}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <button type="button" className="sd-mermaid-control" onClick={onToggleExpanded} aria-label={expanded ? 'Close expanded Mermaid diagram' : 'Expand Mermaid diagram'}>
        {expanded ? <CloseIcon /> : <ExpandIcon />}
      </button>
    </div>
  )
}

interface MermaidViewportProps {
  svg: string
  zoom: number
  expanded: boolean
  onExpand: () => void
}

function MermaidViewport({ svg, zoom, expanded, onExpand }: MermaidViewportProps) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (expanded) {
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onExpand()
    }
  }

  return (
    <div
      role={expanded ? undefined : 'button'}
      className="sd-mermaid-viewport"
      onClick={expanded ? undefined : onExpand}
      onKeyDown={handleKeyDown}
      aria-label={expanded ? 'Expanded Mermaid diagram' : 'Expand Mermaid diagram'}
      tabIndex={expanded ? -1 : 0}
    >
      <span
        className="sd-mermaid-svg"
        style={{ transform: `scale(${zoom})` }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}

export const MermaidDiagram = memo<MermaidDiagramProps>(({ code }) => {
  const [zoom, setZoom] = useState(1)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [fallbackSvg, setFallbackSvg] = useState('')
  const [fallbackError, setFallbackError] = useState<string | null>(null)
  const [fallbackPending, setFallbackPending] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const portalTarget = typeof document === 'undefined' ? null : document.body
  const beautifulRender = useMemo(() => createMermaidSvg(code), [code])
  const svg = beautifulRender.svg || fallbackSvg
  const error = beautifulRender.error && !fallbackSvg ? (fallbackError ?? beautifulRender.error) : null

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    setFallbackSvg('')
    setFallbackError(null)

    if (!beautifulRender.error) {
      setFallbackPending(false)
      return
    }

    let cancelled = false
    setFallbackPending(true)
    void renderOfficialMermaidSvg(code)
      .then((officialSvg) => {
        if (!cancelled) {
          setFallbackSvg(officialSvg)
          setFallbackError(null)
        }
      })
      .catch((officialError) => {
        if (!cancelled) {
          setFallbackError(officialError instanceof Error ? officialError.message : 'Unable to render Mermaid diagram.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFallbackPending(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [beautifulRender.error, code])

  useEffect(() => {
    if (!expanded) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [expanded])

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current)
      }
      copyTimerRef.current = setTimeout(() => {
        setCopied(false)
        copyTimerRef.current = null
      }, COPY_RESET_MS)
    })
  }, [code])

  const zoomOut = useCallback(() => {
    setZoom(value => clampZoom(value - ZOOM_STEP))
  }, [])

  const zoomIn = useCallback(() => {
    setZoom(value => clampZoom(value + ZOOM_STEP))
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(1)
  }, [])

  const openExpanded = useCallback(() => {
    setExpanded(true)
  }, [])

  const toggleExpanded = useCallback(() => {
    setExpanded(value => !value)
  }, [])

  if (error || fallbackPending) {
    return (
      <div className="sd-mermaid-block sd-mermaid-block--error">
        <div className="sd-mermaid-error">
          <span>
            {fallbackPending ? 'Rendering Mermaid diagram...' : 'Unable to render Mermaid diagram.'}
          </span>
          <button type="button" className="sd-mermaid-control" onClick={handleCopy} aria-label={copied ? 'Copied Mermaid source' : 'Copy Mermaid source'}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
        {!fallbackPending && <pre><code>{code}</code></pre>}
      </div>
    )
  }

  const lightbox = expanded && portalTarget
    ? createPortal(
        <div className="sd-mermaid-lightbox" role="dialog" aria-modal="true" aria-label="Expanded Mermaid diagram" onClick={() => setExpanded(false)}>
          <div className="sd-mermaid-lightbox-inner" onClick={event => event.stopPropagation()}>
            <MermaidControls
              copied={copied}
              expanded
              zoom={zoom}
              onCopy={handleCopy}
              onZoomOut={zoomOut}
              onZoomIn={zoomIn}
              onReset={resetZoom}
              onToggleExpanded={toggleExpanded}
            />
            <MermaidViewport svg={svg} zoom={zoom} expanded onExpand={openExpanded} />
          </div>
        </div>,
        portalTarget,
      )
    : null

  return (
    <>
      <div className="sd-mermaid-block">
        <MermaidControls
          copied={copied}
          expanded={false}
          zoom={zoom}
          onCopy={handleCopy}
          onZoomOut={zoomOut}
          onZoomIn={zoomIn}
          onReset={resetZoom}
          onToggleExpanded={toggleExpanded}
        />
        <MermaidViewport svg={svg} zoom={zoom} expanded={false} onExpand={openExpanded} />
      </div>
      {lightbox}
    </>
  )
})

MermaidDiagram.displayName = 'MermaidDiagram'
