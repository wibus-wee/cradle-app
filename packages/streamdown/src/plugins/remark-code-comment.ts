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

  interface PhrasingContentMap {
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
 * First-class `::code-comment{...}` markdown dialect.
 * Complete directives are tokenized atomically by micromark (GFM-safe);
 * incomplete forms remain plain text for lossless streaming.
 */
export const remarkCodeComment = createRemarkAttributeDirective({
  name: 'code-comment',
})
