import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Components } from 'react-markdown'

import { StaticRender } from '../../../src/static-render'
import { Streamdown } from '../../../src/streamdown'
import type { RendererDriver, ScenarioName } from '../contracts'

const plainCodeComponents: Components = {
  code: ({ children }) => <code>{children}</code>,
  pre: ({ children }) => <pre>{children}</pre>,
}

export function createRenderer(container: HTMLElement): RendererDriver {
  const root = createRoot(container)

  return {
    render(content: string, streaming: boolean, scenario: ScenarioName) {
      flushSync(() => {
        if (scenario === 'typical-stream' || scenario === 'paced-production') {
          root.render(
            <Streamdown
              content={content}
              streaming={streaming}
              animationPreset="balanced"
              animateMode="char"
              showCursor={false}
              components={plainCodeComponents}
            />,
          )
          return
        }

        root.render(<StaticRender content={content} components={plainCodeComponents} />)
      })
    },
    unmount() {
      flushSync(() => root.unmount())
    },
  }
}
