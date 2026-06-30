import { useCallback, useEffect, useRef, useState } from 'react'

import { shouldBypassSmoother } from '../core/fence-state'
import { pushBufferHistory, pushCpsHistory, updateDebugState } from '../profiler/debug-store'
import type { StreamProfiler } from '../profiler/profiler'
import { computeSettlingDrain } from './use-settling-drain'

export type SmoothPreset = 'balanced' | 'realtime' | 'silky'

interface PresetConfig {
  baseCps: number
  minCps: number
  maxCps: number
}

const PRESETS: Record<SmoothPreset, PresetConfig> = {
  balanced: { baseCps: 38, minCps: 14, maxCps: 72 },
  realtime: { baseCps: 50, minCps: 20, maxCps: 96 },
  silky: { baseCps: 28, minCps: 10, maxCps: 56 },
}

const LARGE_APPEND_THRESHOLD = 120
const STALL_TIMEOUT_MS = 2000
const EMA_ALPHA_ARRIVAL = 0.15
const EMA_ALPHA_CHUNK = 0.35
const WAKE_TIMER_MS = 50

type Phase = 'idle' | 'active' | 'settling'

export function useSmoothContent(
  content: string,
  streaming: boolean,
  preset: SmoothPreset = 'balanced',
  profiler?: StreamProfiler | null,
): string {
  const [smoothedContent, setSmoothedContent] = useState(content)

  const stateRef = useRef({
    phase: 'idle' as Phase,
    cursor: 0,
    rafId: 0,
    lastFrameTime: 0,
    lastInputTime: 0,
    prevContentLen: 0,
    wasStreaming: false,
    // EMA smoothed values
    emaArrivalCps: 0,
    emaChunkSize: 0,
    // Stall counters
    apiStalls: 0,
    renderStalls: 0,
    lastRenderAdvance: 0,
    // Settling
    settlingStart: 0,
    settlingDuration: 0,
    // Wake timer
    wakeTimerId: 0 as ReturnType<typeof setTimeout> | 0,
    // Debug tick counter
    tickCount: 0,
  })

  const configRef = useRef(PRESETS[preset])
  useEffect(() => {
    configRef.current = PRESETS[preset]
  }, [preset])

  const fullTextRef = useRef(content)
  const bypassSmootherRef = useRef(shouldBypassSmoother(content))
  useEffect(() => {
    fullTextRef.current = content
  }, [content])

  const streamingRef = useRef(streaming)
  useEffect(() => {
    streamingRef.current = streaming
  }, [streaming])

  const profilerRef = useRef(profiler)
  useEffect(() => {
    profilerRef.current = profiler
  }, [profiler])

  const syncImmediate = useCallback(() => {
    const s = stateRef.current
    s.cursor = fullTextRef.current.length
    s.phase = 'idle'
    setSmoothedContent(fullTextRef.current)
  }, [])

  // Visibility handler: sync all pending when tab becomes hidden
  useEffect(() => {
    const handler = () => {
      if (document.hidden) {
        syncImmediate()
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [syncImmediate])

  // RAF release loop — stored in a ref to avoid forward-reference issues
  const tickRef = useRef<FrameRequestCallback>(() => {})

  const cancelScheduledLoop = useCallback(() => {
    const s = stateRef.current
    if (s.rafId !== 0) {
      cancelAnimationFrame(s.rafId)
      s.rafId = 0
    }
    if (s.wakeTimerId) {
      clearTimeout(s.wakeTimerId)
      s.wakeTimerId = 0
    }
  }, [])

  const scheduleWakeTimer = useCallback((onWake: () => void) => {
    const s = stateRef.current
    if (s.wakeTimerId) {
      clearTimeout(s.wakeTimerId)
    }
    s.wakeTimerId = setTimeout(() => {
      s.wakeTimerId = 0
      onWake()
    }, WAKE_TIMER_MS)
  }, [])

  useEffect(() => {
    const tick: FrameRequestCallback = (now: number) => {
      const s = stateRef.current
      const cfg = configRef.current
      const fullText = fullTextRef.current
      const totalLen = fullText.length

      // Fence bypass: if content is inside a bypass-language fence, sync immediately
      if (bypassSmootherRef.current) {
        s.cursor = totalLen
        s.lastRenderAdvance = now
        s.phase = 'idle'
        setSmoothedContent(fullText)
        s.rafId = 0
        return
      }

      if (s.cursor >= totalLen) {
        if (!streamingRef.current) {
          s.phase = 'idle'
          s.rafId = 0
          return
        }
        // Still streaming but caught up — enter wake timer mode
        s.rafId = 0
        scheduleWakeTimer(() => {
          // Check if new content arrived while sleeping
          if (fullTextRef.current.length > s.cursor) {
            s.lastFrameTime = 0
            s.rafId = requestAnimationFrame(tick)
          }
        })
        return
      }

      // Delta time
      const dt = s.lastFrameTime === 0 ? 16.67 : now - s.lastFrameTime
      s.lastFrameTime = now

      // Backlog
      const backlog = totalLen - s.cursor

      // Stall detection (render side)
      if (now - s.lastRenderAdvance > STALL_TIMEOUT_MS && s.phase === 'active') {
        s.renderStalls++
        s.lastRenderAdvance = now
        profilerRef.current?.recordStall()
      }

      // Combined pressure → multiplier
      const combinedPressure
        = backlog * 0.6 + s.emaChunkSize * 0.25 + s.emaArrivalCps * 0.15
      const multiplier = Math.min(4.5, Math.max(1, combinedPressure / cfg.baseCps))

      // Effective CPS
      let effectiveCps = cfg.baseCps * multiplier

      // Stall-safe CPS (Alma): if stalls occurred, cap to drain within safe window
      const totalStalls = s.apiStalls + s.renderStalls
      if (totalStalls > 0 && backlog > 0) {
        const maxGap = STALL_TIMEOUT_MS / 1000
        const safeCps = backlog / (maxGap * (1.5 + totalStalls * 0.2))
        effectiveCps = Math.max(effectiveCps, safeCps)
      }

      // Clamp
      effectiveCps = Math.min(cfg.maxCps, Math.max(cfg.minCps, effectiveCps))

      // Settling: accelerate drain using computeSettlingDrain
      if (s.phase === 'settling') {
        const elapsed = now - s.settlingStart
        if (elapsed >= s.settlingDuration || backlog <= 0) {
          // Drain complete
          s.cursor = totalLen
          s.phase = 'idle'
          s.rafId = 0
          setSmoothedContent(fullText)
          return
        }
        // Use settling drain computation for target CPS
        const remainingBacklog = totalLen - s.cursor
        const { targetCps } = computeSettlingDrain(remainingBacklog)
        effectiveCps = Math.max(effectiveCps, targetCps)
        effectiveCps = Math.min(cfg.maxCps * 2, effectiveCps)
      }

      // Characters to release this frame
      let chars = Math.round(effectiveCps * (dt / 1000))
      if (chars < 1) {
        chars = 1
      }
      let newCursor = Math.min(s.cursor + chars, totalLen)

      // Grapheme cluster protection via Intl.Segmenter when available
      if (newCursor < totalLen && typeof Intl !== 'undefined' && Intl.Segmenter) {
        const code = fullText.charCodeAt(newCursor - 1)
        // Check if we might be mid-grapheme (surrogate pair or combining sequence)
        if (code >= 0xD800 && code <= 0xDBFF) {
          // High surrogate at boundary — include the low surrogate too
          newCursor = Math.min(newCursor + 1, totalLen)
        }
 else if (newCursor > s.cursor) {
          // Use Intl.Segmenter to snap to grapheme boundary
          const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
          const segments = segmenter.segment(fullText.slice(0, newCursor))
          const iter = segments[Symbol.iterator]()
          let last: Intl.SegmentData | undefined
          for (const seg of iter) {
            last = seg
          }
          if (last) {
            const boundaryEnd = last.index + last.segment.length
            if (boundaryEnd <= totalLen) {
              newCursor = boundaryEnd
            }
          }
        }
      }
 else if (newCursor < totalLen) {
        // Fallback: surrogate pair protection only
        const code = fullText.charCodeAt(newCursor - 1)
        if (code >= 0xD800 && code <= 0xDBFF) {
          newCursor = Math.min(newCursor + 1, totalLen)
        }
      }

      s.cursor = newCursor
      s.lastRenderAdvance = now
      s.tickCount++

      const displayedText = fullText.slice(0, newCursor)
      setSmoothedContent(displayedText)

      // Profiler frame recording
      profilerRef.current?.recordFrame({
        charsRevealed: newCursor,
        cps: effectiveCps,
        backlog: totalLen - newCursor,
        blockCount: 0,
        activeBlock: null,
      })

      // Debug store update
      const newBacklog = totalLen - newCursor
      updateDebugState({
        targetLength: totalLen,
        displayedLength: newCursor,
        currentCps: effectiveCps,
        arrivalCps: s.emaArrivalCps,
        phase: s.phase,
        renderStalls: s.renderStalls,
        apiStalls: s.apiStalls,
        backlog: newBacklog,
      })

      // Push history every ~16 ticks (~1 second at 60fps)
      if (s.tickCount % 16 === 0) {
        pushCpsHistory(effectiveCps)
        pushBufferHistory(newBacklog)
      }

      if (newCursor >= totalLen && !streamingRef.current) {
        s.phase = 'idle'
        s.rafId = 0
        return
      }

      s.rafId = requestAnimationFrame(tick)
    }
    tickRef.current = tick
    return cancelScheduledLoop
  }, [cancelScheduledLoop, scheduleWakeTimer])

  const startLoop = useCallback(() => {
    const s = stateRef.current
    // Cancel wake timer if active
    if (s.wakeTimerId) {
      clearTimeout(s.wakeTimerId)
      s.wakeTimerId = 0
    }
    if (s.rafId !== 0) {
      return
    }
    s.lastFrameTime = 0
    s.rafId = requestAnimationFrame(tickRef.current)
  }, [])

  // React to content changes
  useEffect(() => {
    const s = stateRef.current
    const now = performance.now()
    const appendLen = content.length - s.prevContentLen
    const bypassSmoother = shouldBypassSmoother(content)
    bypassSmootherRef.current = bypassSmoother

    if (appendLen > 0) {
      if (bypassSmoother) {
        cancelScheduledLoop()
        s.cursor = content.length
        s.prevContentLen = content.length
        s.phase = 'idle'
        s.lastInputTime = now
        s.lastRenderAdvance = now
        setSmoothedContent(content)
        return
      }

      // EMA chunk size
      s.emaChunkSize
        = s.emaChunkSize === 0
          ? appendLen
          : s.emaChunkSize * (1 - EMA_ALPHA_CHUNK) + appendLen * EMA_ALPHA_CHUNK

      // EMA arrival CPS
      const timeSinceLast = now - s.lastInputTime
      if (timeSinceLast > 0) {
        const instantCps = (appendLen / timeSinceLast) * 1000
        s.emaArrivalCps
          = s.emaArrivalCps === 0
            ? instantCps
            : s.emaArrivalCps * (1 - EMA_ALPHA_ARRIVAL) + instantCps * EMA_ALPHA_ARRIVAL
      }

      // API stall detection
      if (timeSinceLast > STALL_TIMEOUT_MS) {
        s.apiStalls++
        profilerRef.current?.recordStall()
      }

      s.lastInputTime = now

      // Profiler input recording
      profilerRef.current?.recordInput(appendLen)

      // Large append bypass
      if (appendLen >= LARGE_APPEND_THRESHOLD) {
        s.cursor = content.length
        s.prevContentLen = content.length
        setSmoothedContent(content)
        return
      }

      // Transition to active
      if (s.phase === 'idle' || s.phase === 'settling') {
        s.phase = 'active'
      }
      s.prevContentLen = content.length
      startLoop()
    }
 else if (content.length < s.prevContentLen) {
      // Content was reset/replaced (e.g. new message)
      s.cursor = content.length
      s.prevContentLen = content.length
      s.phase = 'idle'
      s.emaArrivalCps = 0
      s.emaChunkSize = 0
      s.apiStalls = 0
      s.renderStalls = 0
      setSmoothedContent(content)
    }
  }, [cancelScheduledLoop, content, startLoop])

  // React to streaming state change
  useEffect(() => {
    const s = stateRef.current

    if (s.wasStreaming && !streaming) {
      // streaming → stopped: enter settling mode
      const backlog = fullTextRef.current.length - s.cursor
      if (backlog > 0) {
        s.phase = 'settling'
        s.settlingStart = performance.now()
        // Use computeSettlingDrain for settling duration
        const { drainMs } = computeSettlingDrain(backlog)
        s.settlingDuration = drainMs
        startLoop()
      }
 else {
        s.phase = 'idle'
      }
    }

    s.wasStreaming = streaming
  }, [streaming, startLoop])

  return smoothedContent
}
