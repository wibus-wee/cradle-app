import * as React from 'react'
import type { Components, UrlTransform } from 'react-markdown'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import type { PluggableList } from 'unified'

import { HighlightedCode, HighlightedPre } from './components/highlighted-code'
import { MarkdownLink } from './components/markdown-link'

interface StaticRenderProps {
  content: string
  className?: string
  /** Custom ReactMarkdown components map */
  components?: Components
  /** Additional rehype plugins */
  rehypePlugins?: PluggableList
  /** Additional remark plugins */
  remarkPlugins?: PluggableList
  /** Custom URL transform for owned schemes such as cradle-asset:// */
  urlTransform?: UrlTransform
  /** Render as a different HTML element */
  as?: 'div' | 'span'
}

const defaultComponents: Components = {
  a: MarkdownLink,
  code: HighlightedCode,
  pre: HighlightedPre,
}

export function StaticRender({
  content,
  className,
  components,
  rehypePlugins,
  remarkPlugins,
  urlTransform = defaultUrlTransform,
  as: Component = 'div',
}: StaticRenderProps) {
  const merged = components
    ? { ...defaultComponents, ...components }
    : defaultComponents

  return (
    <Component className={className} data-pre-mounted="">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, ...(remarkPlugins || [])]}
        rehypePlugins={[rehypeKatex, ...(rehypePlugins || [])]}
        components={merged}
        urlTransform={urlTransform}
      >
        {content}
      </ReactMarkdown>
    </Component>
  )
}
