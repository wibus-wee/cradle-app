import type * as React from 'react'
import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { PluggableList } from 'unified'

import { HighlightedCode, HighlightedPre } from '../components/highlighted-code'
import { MarkdownLink } from '../components/markdown-link'
import type { BlockState } from '../hooks/use-block-queue'
import { createCoreRehypePlugins } from '../plugins/markdown-html'
import rehypeStreamAnimate from '../plugins/rehype-stream-animate'

interface BlockProps {
  content: string
  state: BlockState
  births?: number[]
  animated: boolean
  nowMs: number
  fadeDuration: number
  settled: boolean
  animateMode?: 'char' | 'word'
  /** Whether this is the last actively streaming block (cursor shown via CSS) */
  isActiveEnd?: boolean
  /** Custom ReactMarkdown components */
  components?: Record<string, React.ComponentType<unknown>>
  /** Extra rehype plugins */
  extraRehypePlugins?: unknown[]
  /** Extra remark plugins */
  extraRemarkPlugins?: unknown[]
}

/**
 * Renders a single markdown block.
 * - When settled, renders markdown without animation spans
 * - When active and animated, uses birth-timestamp based animation
 * - Memoized on content + settled flag to minimize re-renders
 */
const Block = memo<BlockProps>(({
  content,
  state: _state,
  births,
  animated,
  nowMs,
  fadeDuration,
  settled,
  animateMode = 'word',
  isActiveEnd = false,
  components,
  extraRehypePlugins,
  extraRemarkPlugins,
}) => {
  // eslint-disable-next-line ts/no-explicit-any
  const rehypePlugins: any[] = createCoreRehypePlugins() as any[]

  if (animated && !settled) {
    rehypePlugins.push([rehypeStreamAnimate, {
      births,
      fadeDuration,
      nowMs,
      mode: animateMode,
    }])
  }

  if (extraRehypePlugins) {
    rehypePlugins.push(...extraRehypePlugins)
  }

  rehypePlugins.push(rehypeKatex)

  const remarkPluginsList: PluggableList = [remarkGfm, remarkMath, ...((extraRemarkPlugins as PluggableList | undefined) ?? [])]

  const mergedComponents = components
    ? { a: MarkdownLink, code: HighlightedCode, pre: HighlightedPre, ...components }
    : { a: MarkdownLink, code: HighlightedCode, pre: HighlightedPre }

  return (
    <div data-birth={settled ? undefined : '1'} className={`stream-block${isActiveEnd ? ' stream-block-active' : ''}`}>
      <ReactMarkdown
        remarkPlugins={remarkPluginsList}
        rehypePlugins={rehypePlugins}
        components={mergedComponents as Record<string, React.ComponentType<never>>}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}, (prev, next) => {
  // Only re-render if content changed or settled status changed
  // When settled, block never needs to re-render again
  if (prev.settled && next.settled && prev.content === next.content && prev.isActiveEnd === next.isActiveEnd) {
    return true
  }
  if (prev.content !== next.content) {
    return false
  }
  if (prev.settled !== next.settled) {
    return false
  }
  if (prev.animated !== next.animated) {
    return false
  }
  if (prev.isActiveEnd !== next.isActiveEnd) {
    return false
  }
  return true
})

Block.displayName = 'StreamBlock'
export { Block }
export type { BlockProps }
