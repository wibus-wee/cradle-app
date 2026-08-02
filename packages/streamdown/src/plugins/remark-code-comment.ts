import { createRemarkAttributeDirective } from './remark-attribute-directive'

declare module 'mdast' {
  interface BlockContentMap {
    'code-comment': {
      type: 'code-comment'
      data: {
        hName: 'code-comment'
        hProperties: Record<string, string>
      }
      children: []
    }
  }
}

/**
 * Turns complete Codex review directives into a custom markdown element.
 * Incomplete directives deliberately remain plain text so streaming stays lossless.
 */
export const remarkCodeComment = createRemarkAttributeDirective({
  prefix: '::code-comment{',
  name: 'code-comment',
})
