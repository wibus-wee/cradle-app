import * as React from 'react'
import type { PluggableList } from 'unified'

import type { SmoothPreset } from './hooks/use-smooth-content'
import type { AnimationPreset, AnimationPresetName } from './presets/types'
import { StaticRender } from './static-render'
import { StreamdownRender } from './streamdown-render'

export interface StreamdownProps {
  /** The markdown content to render */
  content: string
  /** Whether content is still being streamed */
  streaming?: boolean
  /** Whether to run the streaming smoother and reveal animation. */
  animated?: boolean
  /** CPS smoother preset */
  preset?: SmoothPreset
  /** Animation visual preset (minimal/balanced/dramatic or custom) */
  animationPreset?: AnimationPresetName | AnimationPreset
  /** Animation granularity */
  animateMode?: 'char' | 'word'
  /** Show blinking cursor at stream edge (default: true) */
  showCursor?: boolean
  /** Custom ReactMarkdown components map */
  components?: Record<string, React.ComponentType<unknown>>
  /** Additional rehype plugins (applied after core plugins) */
  rehypePlugins?: PluggableList
  /** Additional remark plugins (applied after core plugins) */
  remarkPlugins?: PluggableList
  /** Container className */
  className?: string
}

/**
 * Streamdown — streaming markdown renderer.
 * Automatically switches between streaming and static rendering.
 */
export function Streamdown({
  content,
  streaming = false,
  animated = true,
  preset = 'balanced',
  animationPreset,
  animateMode = 'word',
  showCursor,
  components,
  rehypePlugins,
  remarkPlugins,
  className,
}: StreamdownProps) {
  if (!streaming) {
    return <StaticRender content={content} className={className} components={components} rehypePlugins={rehypePlugins} remarkPlugins={remarkPlugins} />
  }

  if (!animated) {
    return (
      <div className={className} data-streamdown-plain-text="">
        <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{content}</span>
      </div>
    )
  }

  return (
    <StreamdownRender
      content={content}
      streaming={streaming}
      preset={preset}
      animationPreset={animationPreset}
      animateMode={animateMode}
      showCursor={showCursor}
      components={components}
      rehypePlugins={rehypePlugins}
      remarkPlugins={remarkPlugins}
      className={className}
    />
  )
}
