import * as React from 'react'

import { useScrollDebugState } from './scroll-debug-state'

interface DebugInspectorProps {
  /** Whether to show the panel */
  enabled?: boolean
}

/**
 * Portal-rendered debug overlay showing scroll metrics.
 * Shows: scrollOffset, distanceFromBottom, isAtBottom, isScrolling, isGenerating, recent log.
 */
export function DebugInspector({ enabled = true }: DebugInspectorProps) {
  const state = useScrollDebugState()

  if (!enabled) {
    return null
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        left: 8,
        padding: '8px 12px',
        background: 'rgba(0,0,0,0.9)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: 10,
        borderRadius: 6,
        zIndex: 99999,
        pointerEvents: 'none',
        lineHeight: 1.6,
        minWidth: 200,
        maxHeight: 300,
        overflow: 'hidden',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4, color: '#0ff' }}>Scroll Debug</div>
      <div>
Offset:
{state.scrollOffset.toFixed(0)}
      </div>
      <div>
Size:
{state.scrollSize.toFixed(0)}
{' '}
| Viewport:
{state.viewportSize.toFixed(0)}
      </div>
      <div>
↓ Bottom:
{state.distanceFromBottom.toFixed(0)}
px
      </div>
      <div>
        AtBottom:
{' '}
<span style={{ color: state.isAtBottom ? '#0f0' : '#f55' }}>{state.isAtBottom ? '✓' : '✗'}</span>
        {' '}
Scrolling:
<span style={{ color: state.isScrolling ? '#ff0' : '#0f0' }}>{state.isScrolling ? '↕' : '—'}</span>
        {' '}
Gen:
<span style={{ color: state.isGenerating ? '#3bf' : '#666' }}>{state.isGenerating ? '●' : '○'}</span>
      </div>
      {state.log.length > 0 && (
        <div style={{ marginTop: 4, borderTop: '1px solid #333', paddingTop: 4, maxHeight: 120, overflow: 'hidden' }}>
          {state.log.slice(-6).map((entry, i) => (
            <div key={i} style={{ opacity: 0.7, fontSize: 9 }}>
              {new Date(entry.time).toISOString().slice(11, 23)}
{' '}
{entry.event}
{' '}
{entry.detail ?? ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export type { DebugInspectorProps }
