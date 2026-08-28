import MarkdownRender from 'markstream-react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'

import type { RendererDriver, ScenarioName } from '../contracts'

export function createRenderer(container: HTMLElement): RendererDriver {
  const root = createRoot(container)

  return {
    render(content: string, streaming: boolean, scenario: ScenarioName) {
      flushSync(() => {
        if (scenario === 'typical-stream' || scenario === 'paced-production') {
          root.render(
            <MarkdownRender
              content={content}
              final={!streaming}
              fade={false}
              typewriter={streaming}
              smoothStreaming="auto"
              maxLiveNodes={0}
              batchRendering
              renderBatchSize={80}
              renderBatchDelay={16}
              renderBatchBudgetMs={6}
              deferNodesUntilVisible={false}
              renderCodeBlocksAsPre
            />,
          )
          return
        }

        if (scenario === 'long-document') {
          root.render(<MarkdownRender content={content} final fade={false} renderCodeBlocksAsPre />)
          return
        }

        root.render(
          <MarkdownRender
            content={content}
            final={!streaming}
            fade={false}
            typewriter={false}
            smoothStreaming={false}
            maxLiveNodes={0}
            batchRendering={false}
            deferNodesUntilVisible={false}
            renderCodeBlocksAsPre
          />,
        )
      })
    },
    unmount() {
      flushSync(() => root.unmount())
    },
  }
}
