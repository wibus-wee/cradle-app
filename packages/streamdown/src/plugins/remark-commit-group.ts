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
}

/**
 * Turns complete commit-group directives into a custom markdown element.
 * Incomplete directives deliberately remain plain text so streaming stays lossless.
 */
export const remarkCommitGroup = createRemarkAttributeDirective({
  prefix: '::commit-group{',
  name: 'commit-group',
})
