export type RendererName = 'cradle' | 'markstream'

export type ScenarioName
  = | 'completed'
    | 'typical-stream'
    | 'paced-production'
    | 'burst-full-render'
    | 'long-document'

export interface ScenarioDefinition {
  name: ScenarioName
  targetChars: number
  chunkChars?: number
  chunkDelayMs?: number
}

export interface RendererDriver {
  render: (content: string, streaming: boolean, scenario: ScenarioName) => void
  unmount: () => void
}

export interface PageBenchmarkResult {
  wallMs: number
  ingestMs: number
  settleMs: number
  frameCount: number
  maxFrameGapMs: number
  framesOver25Ms: number
  framesOver50Ms: number
  longTaskCount: number
  longTaskMs: number
  maxLongTaskMs: number
  domElements: number
  htmlBytes: number
  textChars: number
  mutationCount: number
  endSentinelVisible: boolean
}
