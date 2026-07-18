import type { WorkerInitializationRenderOptions, WorkerPoolOptions } from '@pierre/diffs/react'
import { WorkerPoolContextProvider } from '@pierre/diffs/react'
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'
import type { ReactNode } from 'react'

import { DIFF_THEME } from './diff-constants'

const WORKER_POOL_OPTIONS = {
  workerFactory: () => new Worker(WorkerUrl, { type: 'module' }),
  poolSize: 3,
} satisfies WorkerPoolOptions

const WORKER_HIGHLIGHTER_OPTIONS = {
  lineDiffType: 'word',
  theme: DIFF_THEME,
  useTokenTransformer: false,
} satisfies WorkerInitializationRenderOptions

export function DiffWorkerProvider({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}
    >
      {children}
    </WorkerPoolContextProvider>
  )
}
