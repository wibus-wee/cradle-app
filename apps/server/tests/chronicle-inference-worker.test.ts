import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { afterEach, describe, expect, it } from 'vitest'

import { SupervisedChronicleInferenceWorker } from '../src/modules/chronicle/inference-worker'

const workers: SupervisedChronicleInferenceWorker[] = []

function createWorker(options: { maxPending?: number, defaultTimeoutMs?: number } = {}) {
  const worker = new SupervisedChronicleInferenceWorker({
    command: process.execPath,
    args: [join(import.meta.dirname, 'fixtures', 'chronicle-inference-worker.mjs')],
    maxPending: options.maxPending,
    defaultTimeoutMs: options.defaultTimeoutMs,
  })
  workers.push(worker)
  return worker
}

afterEach(async () => {
  await Promise.all(workers.splice(0).map(worker => worker.stop()))
})

describe('supervised Chronicle inference worker', () => {
  it('keeps inference asynchronous and reuses one long-lived worker', async () => {
    const worker = createWorker()
    let timerFired = false
    const first = worker.embed(['delay'])
    const second = worker.embed(['second'])
    setTimeout(() => {
      timerFired = true
    }, 5)

    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(timerFired).toBe(true)
    expect(firstResult.embeddings).toEqual([[1, 5]])
    expect(secondResult.embeddings).toEqual([[2, 6]])
  })

  it('bounds pending work and aborts a queued caller', async () => {
    const worker = createWorker({ maxPending: 2 })
    const active = worker.embed(['delay'])
    const controller = new AbortController()
    const queued = worker.embed(['queued'], { signal: controller.signal })

    await expect(worker.embed(['overflow'])).rejects.toThrow('queue is full')
    controller.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    await expect(active).resolves.toMatchObject({ embeddings: [[1, 5]] })
  })

  it('rejects pending calls on crash and lazily restarts on the next request', async () => {
    const worker = createWorker()

    await expect(worker.embed(['crash'])).rejects.toThrow('forced inference worker crash')
    await expect(worker.embed(['restarted'])).resolves.toMatchObject({
      embeddings: [[1, 9]],
    })
  })

  it('kills a timed-out worker before accepting work in a fresh process', async () => {
    const worker = createWorker({ defaultTimeoutMs: 10 })

    await expect(worker.embed(['delay'])).rejects.toThrow('timed out')
    await expect(worker.embed(['restarted'], { timeoutMs: 1_000 })).resolves.toMatchObject({
      embeddings: [[1, 9]],
    })
  })

  it.runIf(process.env.CRADLE_CHRONICLE_BENCHMARK === '1')('reports event-loop delay while inference is active', async () => {
    const worker = createWorker()
    const startedAt = performance.now()
    const inference = worker.embed(['delay'])
    const timerDelayMs = await new Promise<number>((resolve) => {
      setTimeout(() => resolve(performance.now() - startedAt), 5)
    })
    await inference
    const inferenceMs = performance.now() - startedAt

    console.info(JSON.stringify({ benchmark: 'chronicle-inference-event-loop', timerDelayMs, inferenceMs }))
    expect(inferenceMs).toBeGreaterThanOrEqual(70)
    expect(timerDelayMs).toBeLessThan(inferenceMs)
  })
})
