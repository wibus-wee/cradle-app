import type {
  PageBenchmarkResult,
  RendererDriver,
  RendererName,
  ScenarioDefinition,
} from './contracts'
import { createMarkdownFixture, hasEndSentinel } from './fixtures'

const SETTLE_TIMEOUT_MS = 30_000

interface BenchmarkWindow extends Window {
  __benchmark?: {
    ready: boolean
    run: (scenario: ScenarioDefinition) => Promise<PageBenchmarkResult>
  }
}

const benchmarkWindow = window as BenchmarkWindow
const rendererName = new URLSearchParams(window.location.search).get(
  'renderer',
) as RendererName | null
const container = document.querySelector<HTMLElement>('#benchmark-root')

if (!container || (rendererName !== 'cradle' && rendererName !== 'markstream')) {
  throw new Error('The benchmark requires #benchmark-root and ?renderer=cradle|markstream')
}
const benchmarkContainer = container

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

async function waitForStableDOM(container: HTMLElement, requireSentinel: boolean): Promise<void> {
  const startedAt = performance.now()
  let lastMutationAt = startedAt
  const observer = new MutationObserver(() => {
    lastMutationAt = performance.now()
  })
  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  })

  try {
    while (performance.now() - startedAt < SETTLE_TIMEOUT_MS) {
      await nextFrame()
      const sentinelReady = !requireSentinel || hasEndSentinel(container.textContent ?? '')
      if (sentinelReady && performance.now() - lastMutationAt >= 100) {
        return
      }
    }
    throw new Error(
      `Renderer did not settle within ${SETTLE_TIMEOUT_MS}ms (sentinel required: ${requireSentinel})`,
    )
  }
 finally {
    observer.disconnect()
  }
}

async function run(
  renderer: RendererDriver,
  container: HTMLElement,
  scenario: ScenarioDefinition,
): Promise<PageBenchmarkResult> {
  const content = createMarkdownFixture(scenario.targetChars)
  const frameIntervals: number[] = []
  const longTasks: number[] = []
  let mutationCount = 0
  let previousFrame = performance.now()
  let frameId = 0
  let observingFrames = true

  const measureFrame = (timestamp: number) => {
    frameIntervals.push(timestamp - previousFrame)
    previousFrame = timestamp
    if (observingFrames) {
      frameId = requestAnimationFrame(measureFrame)
    }
  }
  frameId = requestAnimationFrame(measureFrame)

  const longTaskObserver
    = typeof PerformanceObserver !== 'undefined'
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push(entry.duration)
          }
        })
      : null
  try {
    longTaskObserver?.observe({ type: 'longtask', buffered: true })
  }
 catch {
    // Long Task API is not available in every Chromium mode.
  }

  const mutationObserver = new MutationObserver((records) => {
    mutationCount += records.length
  })
  mutationObserver.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  })

  const startedAt = performance.now()
  renderer.render('', true, scenario.name)
  const ingestStartedAt = performance.now()

  if (scenario.chunkChars) {
    for (let offset = scenario.chunkChars; offset < content.length; offset += scenario.chunkChars) {
      renderer.render(content.slice(0, offset), true, scenario.name)
      if (scenario.chunkDelayMs) {
        await delay(scenario.chunkDelayMs)
      }
    }
  }

  renderer.render(content, false, scenario.name)
  const ingestFinishedAt = performance.now()
  await waitForStableDOM(container, scenario.name !== 'long-document')
  await nextFrame()
  const finishedAt = performance.now()

  observingFrames = false
  cancelAnimationFrame(frameId)
  mutationObserver.disconnect()
  longTaskObserver?.disconnect()

  const result: PageBenchmarkResult = {
    wallMs: finishedAt - startedAt,
    ingestMs: ingestFinishedAt - ingestStartedAt,
    settleMs: finishedAt - ingestFinishedAt,
    frameCount: frameIntervals.length,
    maxFrameGapMs: Math.max(0, ...frameIntervals),
    framesOver25Ms: frameIntervals.filter(duration => duration > 25).length,
    framesOver50Ms: frameIntervals.filter(duration => duration > 50).length,
    longTaskCount: longTasks.length,
    longTaskMs: longTasks.reduce((total, duration) => total + duration, 0),
    maxLongTaskMs: Math.max(0, ...longTasks),
    domElements: container.querySelectorAll('*').length,
    htmlBytes: new TextEncoder().encode(container.innerHTML).length,
    textChars: container.textContent?.length ?? 0,
    mutationCount,
    endSentinelVisible: hasEndSentinel(container.textContent ?? ''),
  }

  renderer.unmount()
  container.replaceChildren()
  return result
}

async function initialize(): Promise<void> {
  const rendererModule
    = rendererName === 'cradle'
      ? await import('./renderers/cradle')
      : await import('./renderers/markstream')
  const renderer = rendererModule.createRenderer(benchmarkContainer)

  benchmarkWindow.__benchmark = {
    ready: true,
    run: scenario => run(renderer, benchmarkContainer, scenario),
  }
}

void initialize()
