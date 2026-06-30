import type { ReactNode } from 'react'
import * as React from 'react'
import { createContext, useCallback, useContext, useState } from 'react'

import { useStreamDebugState } from './debug-store'
import type { ProfilerSnapshot } from './profiler'
import { StreamProfiler } from './profiler'

interface ProfilerContextValue {
  profiler: StreamProfiler
  snapshot: ProfilerSnapshot | null
  isRecording: boolean
  start: () => void
  stop: () => ProfilerSnapshot
}

const ProfilerContext = createContext<ProfilerContextValue | null>(null)

export function useProfilerContext(): ProfilerContextValue | null {
  return useContext(ProfilerContext)
}

interface StreamdownProfilerProviderProps {
  children: ReactNode
  /** Show the debug panel overlay */
  showPanel?: boolean
}

export function StreamdownProfilerProvider({ children, showPanel = false }: StreamdownProfilerProviderProps): React.ReactElement {
  const [profiler] = useState(() => new StreamProfiler())
  const [snapshot, setSnapshot] = useState<ProfilerSnapshot | null>(null)
  const [isRecording, setIsRecording] = useState(false)

  const start = useCallback(() => {
    profiler.start()
    setIsRecording(true)
  }, [profiler])

  const stop = useCallback(() => {
    const s = profiler.stop()
    setSnapshot(s)
    setIsRecording(false)
    return s
  }, [profiler])

  const value: ProfilerContextValue = {
    profiler,
    snapshot,
    isRecording,
    start,
    stop,
  }

  return (
    <ProfilerContext.Provider value={value}>
      {children}
      {showPanel && <ProfilerPanel />}
    </ProfilerContext.Provider>
  )
}

/** Minimal debug overlay showing real-time streaming metrics */
function ProfilerPanel() {
  const debug = useStreamDebugState()
  const ctx = useProfilerContext()

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        left: 8,
        padding: '8px 12px',
        background: 'rgba(0,0,0,0.85)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: 11,
        borderRadius: 6,
        zIndex: 99999,
        pointerEvents: 'none',
        lineHeight: 1.5,
        minWidth: 180,
      }}
    >
      <div>
Phase:
{debug.phase}
      </div>
      <div>
CPS:
{debug.currentCps.toFixed(1)}
{' '}
| Arrival:
{debug.arrivalCps.toFixed(1)}
      </div>
      <div>
Backlog:
{debug.backlog}
      </div>
      <div>
Stalls: API=
{debug.apiStalls}
{' '}
Render=
{debug.renderStalls}
      </div>
      {ctx?.isRecording && <div style={{ color: '#f55' }}>● Recording</div>}
      {ctx?.snapshot && (
<div>
Last:
{ctx.snapshot.totalFrames}
f /
{ctx.snapshot.avgFps.toFixed(0)}
fps
</div>
)}
    </div>
  )
}
