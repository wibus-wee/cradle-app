import { beforeEach, describe, expect, it } from 'vitest'

import { StreamProfiler } from './profiler'

describe('streamProfiler', () => {
  let profiler: StreamProfiler

  beforeEach(() => {
    profiler = new StreamProfiler()
  })

  it('starts and stops', () => {
    profiler.start()
    expect(profiler.isActive()).toBe(true)
    const snapshot = profiler.stop()
    expect(profiler.isActive()).toBe(false)
    expect(snapshot.totalFrames).toBe(0)
  })

  it('records frames', () => {
    profiler.start()
    profiler.recordFrame({ charsRevealed: 10, cps: 38, backlog: 5, blockCount: 1, activeBlock: 'b1' })
    profiler.recordFrame({ charsRevealed: 20, cps: 40, backlog: 3, blockCount: 1, activeBlock: 'b1' })
    const snapshot = profiler.stop()
    expect(snapshot.totalFrames).toBe(2)
    expect(snapshot.peakCps).toBe(40)
  })

  it('records stalls', () => {
    profiler.start()
    profiler.recordStall()
    profiler.recordStall()
    const snapshot = profiler.stop()
    expect(snapshot.stallCount).toBe(2)
  })

  it('records input appends', () => {
    profiler.start()
    profiler.recordInput(50)
    profiler.recordInput(30)
    const snapshot = profiler.stop()
    expect(snapshot.totalChars).toBe(80)
  })

  it('resets state', () => {
    profiler.start()
    profiler.recordFrame({ charsRevealed: 10, cps: 38, backlog: 5, blockCount: 1, activeBlock: null })
    profiler.reset()
    expect(profiler.isActive()).toBe(false)
  })
})
