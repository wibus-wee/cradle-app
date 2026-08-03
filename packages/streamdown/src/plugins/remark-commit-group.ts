import { createRemarkAttributeDirective } from './remark-attribute-directive'

declare module 'mdast' {
  interface BlockContentMap {
    'commit-group': {
      type: 'commit-group'
      data: {
        hName: 'commit-group'
        hProperties: Record<string, string>
      }
      children: []
    }
  }

  interface PhrasingContentMap {
    'commit-group': {
      type: 'commit-group'
      data: {
        hName: 'commit-group'
        hProperties: Record<string, string>
      }
      children: []
    }
  }
}

/**
 * First-class `::commit-group{...}` markdown dialect.
 * Complete directives are tokenized atomically by micromark (GFM-safe);
 * incomplete forms remain plain text for lossless streaming.
 */
export const remarkCommitGroup = createRemarkAttributeDirective({
  name: 'commit-group',
})
