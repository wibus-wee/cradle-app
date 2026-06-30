export interface FrameMetrics {
  timestamp: number
  charsRevealed: number
  cps: number
  backlog: number
  fps: number
  blockCount: number
  activeBlock: string | null
}

export interface ProfilerSnapshot {
  startTime: number
  endTime: number
  totalChars: number
  totalFrames: number
  avgCps: number
  avgFps: number
  peakCps: number
  minFps: number
  stallCount: number
  frames: FrameMetrics[]
}

export class StreamProfiler {
  private frames: FrameMetrics[] = []
  private startTime = 0
  private lastFrameTime = 0
  private totalChars = 0
  private stallCount = 0
  private active = false

  start(): void {
    this.reset()
    this.startTime = performance.now()
    this.lastFrameTime = this.startTime
    this.active = true
  }

  stop(): ProfilerSnapshot {
    this.active = false
    const endTime = performance.now()
    const totalFrames = this.frames.length

    let sumCps = 0
    let sumFps = 0
    let peakCps = 0
    let minFps = Infinity

    for (const frame of this.frames) {
      sumCps += frame.cps
      sumFps += frame.fps
      if (frame.cps > peakCps) {
        peakCps = frame.cps
      }
      if (frame.fps < minFps) {
        minFps = frame.fps
      }
    }

    return {
      startTime: this.startTime,
      endTime,
      totalChars: this.totalChars,
      totalFrames,
      avgCps: totalFrames > 0 ? sumCps / totalFrames : 0,
      avgFps: totalFrames > 0 ? sumFps / totalFrames : 0,
      peakCps,
      minFps: totalFrames > 0 ? minFps : 0,
      stallCount: this.stallCount,
      frames: this.frames,
    }
  }

  recordFrame(metrics: Omit<FrameMetrics, 'timestamp' | 'fps'>): void {
    if (!this.active) {
      return
    }

    const now = performance.now()
    const dt = now - this.lastFrameTime
    const fps = dt > 0 ? 1000 / dt : 0

    this.frames.push({
      ...metrics,
      timestamp: now,
      fps,
    })

    this.lastFrameTime = now
  }

  recordInput(appendSize: number): void {
    if (!this.active) {
      return
    }
    this.totalChars += appendSize
  }

  recordStall(): void {
    if (!this.active) {
      return
    }
    this.stallCount++
  }

  isActive(): boolean {
    return this.active
  }

  reset(): void {
    this.frames = []
    this.startTime = 0
    this.lastFrameTime = 0
    this.totalChars = 0
    this.stallCount = 0
    this.active = false
  }
}
