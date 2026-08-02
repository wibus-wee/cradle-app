import type {
  Paragraph,
  PhrasingContent,
  Root,
} from 'mdast'
import type { Plugin } from 'unified'
import { SKIP, visit } from 'unist-util-visit'

interface DirectiveSegment {
  type: 'directive'
  attributes: Record<string, string>
}

interface TextSegment {
  type: 'text'
  value: string
}

type Segment = DirectiveSegment | TextSegment

export interface AttributeDirectiveNode {
  type: string
  data: {
    hName: string
    hProperties: Record<string, string>
  }
  children: []
}

export interface RemarkAttributeDirectiveOptions {
  /** Full directive opener, e.g. `::code-comment{`. */
  prefix: string
  /** mdast / hast node type and hName. */
  name: string
}

function parseDirectiveAttributes(
  source: string,
  startIndex: number,
): { attributes: Record<string, string>, endIndex: number } | null {
  const attributes: Record<string, string> = {}
  let index = startIndex

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index]!)) {
      index += 1
    }
    if (source[index] === '}') {
      return { attributes, endIndex: index + 1 }
    }

    const keyMatch = /^[A-Z][\w-]*/i.exec(source.slice(index))
    if (!keyMatch) {
      return null
    }
    const key = keyMatch[0]
    index += key.length

    while (index < source.length && /\s/.test(source[index]!)) {
      index += 1
    }
    if (source[index] !== '=') {
      return null
    }
    index += 1
    while (index < source.length && /\s/.test(source[index]!)) {
      index += 1
    }

    let value = ''
    if (source[index] === '"') {
      index += 1
      let closed = false
      while (index < source.length) {
        const char = source[index]!
        if (char === '\\' && source[index + 1] === '"') {
          value += '"'
          index += 2
          continue
        }
        if (char === '"') {
          closed = true
          index += 1
          break
        }
        value += char
        index += 1
      }
      if (!closed) {
        return null
      }
    }
    else {
      const bareMatch = /^[^\s}]+/.exec(source.slice(index))
      if (!bareMatch) {
        return null
      }
      value = bareMatch[0]
      index += value.length
    }

    attributes[key] = value
  }

  return null
}

function splitDirectives(text: string, prefix: string): Segment[] | null {
  const segments: Segment[] = []
  let cursor = 0
  let found = false

  for (;;) {
    const start = text.indexOf(prefix, cursor)
    if (start === -1) {
      break
    }
    const parsed = parseDirectiveAttributes(text, start + prefix.length)
    if (!parsed) {
      cursor = start + prefix.length
      continue
    }
    if (start > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, start) })
    }
    segments.push({ type: 'directive', attributes: parsed.attributes })
    cursor = parsed.endIndex
    found = true
  }

  if (!found) {
    return null
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) })
  }
  return segments
}

function readRawInlineText(children: readonly PhrasingContent[]): string | null {
  let raw = ''
  for (const child of children) {
    switch (child.type) {
      case 'text':
        raw += child.value
        break
      case 'inlineCode':
        raw += `\`${child.value}\``
        break
      case 'emphasis':
      case 'strong':
      case 'delete': {
        const marker = child.type === 'emphasis' ? '*' : child.type === 'strong' ? '**' : '~~'
        const inner = readRawInlineText(child.children)
        if (inner === null) {
          return null
        }
        raw += marker + inner + marker
        break
      }
      default:
        return null
    }
  }
  return raw
}

function createTextParagraph(value: string): Paragraph {
  return {
    type: 'paragraph',
    children: [{ type: 'text', value }],
  }
}

function createDirectiveNode(
  name: string,
  attributes: Record<string, string>,
): AttributeDirectiveNode {
  return {
    type: name,
    data: {
      hName: name,
      hProperties: attributes,
    },
    children: [],
  }
}

/**
 * Turns complete `::name{attr="value"}` directives into custom markdown elements.
 * Incomplete directives deliberately remain plain text so streaming stays lossless.
 */
export function createRemarkAttributeDirective(
  options: RemarkAttributeDirectiveOptions,
): Plugin<[], Root> {
  const { prefix, name } = options

  return () => (tree) => {
    visit(tree, 'paragraph', (node, index, parent) => {
      if (!parent || typeof index !== 'number') {
        return
      }
      const fullText = readRawInlineText(node.children)
      if (!fullText || !fullText.includes(prefix)) {
        return
      }
      const segments = splitDirectives(fullText, prefix)
      if (!segments) {
        return
      }

      const replacement: Array<Paragraph | AttributeDirectiveNode> = []
      for (const segment of segments) {
        if (segment.type === 'text') {
          const value = segment.value.trim()
          if (value) {
            replacement.push(createTextParagraph(value))
          }
        }
        else {
          replacement.push(createDirectiveNode(name, segment.attributes))
        }
      }
      // Attribute directive nodes are registered via mdast module augmentation by callers.
      const nextChildren = parent.children as Array<Paragraph | AttributeDirectiveNode>
      nextChildren.splice(index, 1, ...replacement)
      return [SKIP, index + replacement.length]
    })
  }
}
