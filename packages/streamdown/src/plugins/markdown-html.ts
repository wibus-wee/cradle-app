import rehypeRaw from 'rehype-raw'
import type { Options as RehypeSanitizeOptions } from 'rehype-sanitize'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { PluggableList } from 'unified'

const tagNames = [
  ...(defaultSchema.tagNames ?? []),
  'code-comment',
  'commit-group',
  'kbd',
  'colgroup',
  'col',
]

const sharedAttributes = [
  ...((defaultSchema.attributes?.['*'] ?? []) as string[]),
  'abbr',
  'ariaDescribedBy',
  'ariaLabel',
  'ariaLabelledBy',
  'dir',
  'lang',
  'title',
]

const tableCellAttributes = ['abbr', 'align', 'colSpan', 'headers', 'rowSpan', 'scope']

export const markdownHtmlSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames,
  attributes: {
    ...defaultSchema.attributes,
    '*': sharedAttributes,
    'code-comment': ['body', 'end', 'file', 'priority', 'start', 'title'],
    'commit-group': ['body', 'files', 'message'],
    'table': [
      ...((defaultSchema.attributes?.table ?? []) as string[]),
      'align',
      'summary',
    ],
    'th': [
      ...((defaultSchema.attributes?.th ?? []) as string[]),
      ...tableCellAttributes,
    ],
    'td': [
      ...((defaultSchema.attributes?.td ?? []) as string[]),
      ...tableCellAttributes,
    ],
    'col': [
      ...((defaultSchema.attributes?.col ?? []) as string[]),
      'align',
      'span',
      'width',
    ],
    'img': [
      ...((defaultSchema.attributes?.img ?? []) as string[]),
      'height',
      'width',
    ],
  },
}

export function createCoreRehypePlugins(extraPlugins?: PluggableList): PluggableList {
  return [
    rehypeRaw,
    [rehypeSanitize, markdownHtmlSchema],
    ...(extraPlugins ?? []),
  ]
}
