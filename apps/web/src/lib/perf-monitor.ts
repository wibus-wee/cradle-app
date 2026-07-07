import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals'

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number
      totalJSHeapSize: number
      jsHeapSizeLimit: number
    }
  }
}

export interface MemorySnapshot {
  timestamp: number
  heapUsed: number
  heapTotal: number
  heapLimit: number
}

export interface VitalEntry {
  name: string
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  timestamp: number
}

export interface LongTaskSnapshot {
  timestamp: number
  duration: number
  name: string
}

export interface PaintSnapshot {
  timestamp: number
  name: string
  startTime: number
  duration: number
}

const BUFFER_CAP = 200
const SAMPLE_INTERVAL_MS = 30_000
const LEAK_THRESHOLD = 10
const USER_TIMING_CLEANUP_INTERVAL_MS = 5_000
const USER_TIMING_ENTRY_LIMIT = 1_000

const snapshots: MemorySnapshot[] = []
const vitals: VitalEntry[] = []
const longTasks: LongTaskSnapshot[] = []
const paints: PaintSnapshot[] = []
let intervalId: ReturnType<typeof setInterval> | null = null
let longTaskObserver: PerformanceObserver | null = null
let paintObserver: PerformanceObserver | null = null
let consecutiveIncreases = 0
let lastHeapUsed = 0
let lastMeasureEntryCount = 0
let lastMarkEntryCount = 0
let clearedMeasureEntryCount = 0
let clearedMarkEntryCount = 0

function hasPerformanceMemory(perf: Performance): perf is Performance & { memory: NonNullable<Performance['memory']> } {
  return 'memory' in perf
}

function pushSnapshot(buf: MemorySnapshot[], entry: MemorySnapshot) {
  if (buf.length >= BUFFER_CAP) {
    buf.shift()
  }
  buf.push(entry)
}

function pushVital(buf: VitalEntry[], entry: VitalEntry) {
  if (buf.length >= BUFFER_CAP) {
    buf.shift()
  }
  buf.push(entry)
}

function pushLongTask(buf: LongTaskSnapshot[], entry: LongTaskSnapshot) {
  if (buf.length >= BUFFER_CAP) {
    buf.shift()
  }
  buf.push(entry)
}

function pushPaint(buf: PaintSnapshot[], entry: PaintSnapshot) {
  if (buf.length >= BUFFER_CAP) {
    buf.shift()
  }
  buf.push(entry)
}

function sampleMemory() {
  if (!hasPerformanceMemory(performance)) {
    return
  }
  const mem = performance.memory
  const snap: MemorySnapshot = {
    timestamp: Date.now(),
    heapUsed: mem.usedJSHeapSize,
    heapTotal: mem.totalJSHeapSize,
    heapLimit: mem.jsHeapSizeLimit,
  }
  pushSnapshot(snapshots, snap)

  if (snap.heapUsed > lastHeapUsed && lastHeapUsed > 0) {
    consecutiveIncreases++
    if (consecutiveIncreases >= LEAK_THRESHOLD) {
      console.warn('[perf] possible memory leak detected')
    }
  }
 else {
    consecutiveIncreases = 0
  }
  lastHeapUsed = snap.heapUsed
}

function collectWebVitals() {
  const record = (name: string) => (metric: { value: number, rating: 'good' | 'needs-improvement' | 'poor' }) => {
    pushVital(vitals, {
      name,
      value: metric.value,
      rating: metric.rating,
      timestamp: Date.now(),
    })
  }
  onLCP(record('LCP'))
  onCLS(record('CLS'))
  onINP(record('INP'))
  onTTFB(record('TTFB'))
}

function collectLongTasks() {
  if (longTaskObserver !== null || typeof PerformanceObserver === 'undefined') {
    return
  }
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        pushLongTask(longTasks, {
          timestamp: Date.now(),
          duration: entry.duration,
          name: entry.name,
        })
      }
    })
    longTaskObserver.observe({ type: 'longtask', buffered: true })
  }
  catch {
    longTaskObserver = null
  }
}

function collectPaints() {
  if (paintObserver !== null || typeof PerformanceObserver === 'undefined') {
    return
  }
  try {
    paintObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        pushPaint(paints, {
          timestamp: Date.now(),
          name: entry.name,
          startTime: entry.startTime,
          duration: entry.duration,
        })
      }
    })
    paintObserver.observe({ type: 'paint', buffered: true })
  }
  catch {
    paintObserver = null
  }
}

function cleanupUserTimingEntries() {
  const measureCount = performance.getEntriesByType('measure').length
  const markCount = performance.getEntriesByType('mark').length
  lastMeasureEntryCount = measureCount
  lastMarkEntryCount = markCount

  if (measureCount > USER_TIMING_ENTRY_LIMIT) {
    performance.clearMeasures()
    clearedMeasureEntryCount += measureCount
    lastMeasureEntryCount = 0
  }
  if (markCount > USER_TIMING_ENTRY_LIMIT) {
    performance.clearMarks()
    clearedMarkEntryCount += markCount
    lastMarkEntryCount = 0
  }
}

export function getPerfSnapshots(): MemorySnapshot[] {
  return [...snapshots]
}

export function getWebVitals(): VitalEntry[] {
  return [...vitals]
}

export function getLongTaskSnapshots(): LongTaskSnapshot[] {
  return [...longTasks]
}

export function getPaintSnapshots(): PaintSnapshot[] {
  return [...paints]
}

export function getUserTimingStats(): Record<string, number> {
  cleanupUserTimingEntries()
  return {
    measureEntryCount: lastMeasureEntryCount,
    markEntryCount: lastMarkEntryCount,
    clearedMeasureEntryCount,
    clearedMarkEntryCount,
    entryLimit: USER_TIMING_ENTRY_LIMIT,
  }
}

export function initPerfMonitor() {
  if (intervalId !== null) {
    return
  }

  sampleMemory()
  intervalId = setInterval(sampleMemory, SAMPLE_INTERVAL_MS)
  cleanupUserTimingEntries()
  setInterval(cleanupUserTimingEntries, USER_TIMING_CLEANUP_INTERVAL_MS)
  collectWebVitals()
  collectLongTasks()
  collectPaints()
}
