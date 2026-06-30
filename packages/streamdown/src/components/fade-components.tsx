import type { ComponentType, HTMLAttributes } from 'react'
import * as React from 'react'
import { forwardRef } from 'react'

type FadableTag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'li' | 'strong' | 'em' | 'blockquote' | 'a' | 'span'

/**
 * Creates a fade-animated wrapper for a given HTML tag.
 * Each text child gets split into words and wrapped with staggered fade-in.
 *
 * Usage with react-markdown:
 * ```
 * <ReactMarkdown components={fadeComponents} />
 * ```
 */
function makeFader<T extends FadableTag>(tag: T): ComponentType<HTMLAttributes<HTMLElement>> {
  const FaderComponent = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
    (props, ref) => {
      const { children, ...rest } = props
      const Tag = tag as any
      return <Tag ref={ref} data-fade-walk="" {...rest}>{children}</Tag>
    },
  )
  FaderComponent.displayName = `Fader(${tag})`
  return FaderComponent as any
}

/**
 * Pre-built fade components map for react-markdown.
 *
 * Usage:
 * ```tsx
 * import { fadeComponents } from '@cradle/streamdown'
 * <ReactMarkdown components={fadeComponents}>{content}</ReactMarkdown>
 * ```
 */
export const fadeComponents: Partial<Record<FadableTag, ComponentType<any>>> = {
  p: makeFader('p'),
  h1: makeFader('h1'),
  h2: makeFader('h2'),
  h3: makeFader('h3'),
  h4: makeFader('h4'),
  h5: makeFader('h5'),
  h6: makeFader('h6'),
  li: makeFader('li'),
  strong: makeFader('strong'),
  em: makeFader('em'),
  blockquote: makeFader('blockquote'),
}

export { makeFader }
export type { FadableTag }
