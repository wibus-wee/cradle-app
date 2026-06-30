import type { AnimationPresetName, SmoothPreset } from '@cradle/streamdown'
import { AutoScroll, Streamdown, StreamdownProfilerProvider } from '@cradle/streamdown'
import { useCallback, useEffect, useRef, useState } from 'react'

import { ControlPanel } from './components/control-panel'
import { Sidebar } from './components/sidebar'
import { StatusBar } from './components/status-bar'
import { SAMPLES } from './data/samples'
import { DocsPage } from './pages/docs'
import { ToolCallStreamPage } from './pages/tool-call-stream'

export function App() {
  const [activeComponent, setActiveComponent] = useState('streamdown')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Streamdown state
  const [content, setContent] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [preset, setPreset] = useState<SmoothPreset>('balanced')
  const [animationPreset, setAnimationPreset] = useState<AnimationPresetName>('balanced')
  const [animateMode, setAnimateMode] = useState<'char' | 'word'>('word')
  const [showCursor, setShowCursor] = useState(true)
  const [cps, setCps] = useState(80)
  const [sampleId, setSampleId] = useState('english-technical')
  const [showProfiler, setShowProfiler] = useState(false)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  // Streaming metrics
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const indexRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const currentSource = SAMPLES.find(s => s.id === sampleId)?.content ?? ''

  const stopStreaming = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setStreaming(false)
  }, [])

  const startStreaming = useCallback(() => {
    if (streaming) {
      return
    }
    const source = currentSource
    // Continue from current position if content exists, otherwise start fresh
    const startIndex = content.length > 0 && content.length < source.length
      ? content.length
      : 0
    if (startIndex === 0) {
      setContent('')
      setElapsed(0)
      startTimeRef.current = Date.now()
    }
    indexRef.current = startIndex
    setStreaming(true)

    if (!timerRef.current) {
      if (startIndex === 0) {
        startTimeRef.current = Date.now()
      }
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - startTimeRef.current)
      }, 100)
    }

    const charsPerTick = Math.max(1, Math.round(cps / 60))
    intervalRef.current = setInterval(() => {
      indexRef.current += charsPerTick
      if (indexRef.current >= source.length) {
        setContent(source)
        setStreaming(false)
        setElapsed(Date.now() - startTimeRef.current)
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
      }
 else {
        setContent(source.slice(0, indexRef.current))
      }
    }, 1000 / 60)
  }, [content, currentSource, cps, streaming])

  const reset = useCallback(() => {
    stopStreaming()
    setContent('')
    setElapsed(0)
  }, [stopStreaming])

  // Handle dark mode toggle
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [])

  return (
    <StreamdownProfilerProvider showPanel={showProfiler}>
      <div className="flex h-full bg-background">
        <Sidebar
          activeComponent={activeComponent}
          onComponentChange={setActiveComponent}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {activeComponent === 'streamdown' && (
            <>
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
                <div className="prose mx-auto max-w-3xl px-8 py-10">
                  <Streamdown
                    content={content}
                    streaming={streaming}
                    preset={preset}
                    animationPreset={animationPreset}
                    animateMode={animateMode}
                    showCursor={showCursor}
                  />
                  {!content && !streaming && (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                      <p className="text-sm text-muted-foreground">
                        Select a sample and click Stream to begin
                      </p>
                    </div>
                  )}
                </div>
                <AutoScroll containerRef={scrollContainerRef} generating={streaming} />
              </div>

              <StatusBar
                streaming={streaming}
                cps={cps}
                elapsed={elapsed}
                charsRevealed={content.length}
                totalChars={currentSource.length}
                preset={preset}
                animateMode={animateMode}
              />
            </>
          )}

          {activeComponent === 'docs' && (
            <div className="flex-1 overflow-y-auto">
              <DocsPage />
            </div>
          )}

          {activeComponent === 'tool-call-stream' && (
            <div className="flex-1 overflow-hidden">
              <ToolCallStreamPage />
            </div>
          )}

          {activeComponent !== 'streamdown' && activeComponent !== 'docs' && activeComponent !== 'tool-call-stream' && (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                Component not yet available
              </p>
            </div>
          )}
        </div>

        {activeComponent === 'streamdown' && (
          <ControlPanel
            preset={preset}
            onPresetChange={setPreset}
            animateMode={animateMode}
            onAnimateModeChange={setAnimateMode}
            animationPreset={animationPreset}
            onAnimationPresetChange={setAnimationPreset}
            showCursor={showCursor}
            onShowCursorChange={setShowCursor}
            cps={cps}
            onCpsChange={setCps}
            sampleId={sampleId}
            onSampleChange={setSampleId}
            streaming={streaming}
            onStart={startStreaming}
            onStop={stopStreaming}
            onReset={reset}
            showProfiler={showProfiler}
            onProfilerChange={setShowProfiler}
            dark={dark}
            onDarkChange={setDark}
          />
        )}
      </div>
    </StreamdownProfilerProvider>
  )
}
