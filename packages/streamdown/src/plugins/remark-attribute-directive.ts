import type { BlockContent, Paragraph, PhrasingContent, Root, RootContent } from 'mdast'
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Token,
} from 'mdast-util-from-markdown'
import type {
  Code,
  Construct,
  Effects,
  Extension as MicromarkExtension,
  State,
  TokenizeContext,
} from 'micromark-util-types'
import type { Plugin, Processor } from 'unified'
import { SKIP, visit } from 'unist-util-visit'

export interface AttributeDirectiveNode {
  type: string
  data: {
    hName: string
    hProperties: Record<string, string>
  }
  children: []
}

export interface RemarkAttributeDirectiveOptions {
  /**
   * Directive name without the `::` marker, e.g. `commit-group`.
   * Complete forms look like `::commit-group{message="..."}`.
   */
  name: string
}

/**
 * Parse `key="value"` / bare attributes used by Cradle attribute directives.
 */
export function parseDirectiveAttributes(
  source: string,
  startIndex = 0,
): { attributes: Record<string, string>, endIndex: number } | null {
  const attributes: Record<string, string> = {}
  let index = startIndex

  while (index < source.length) {
    while (index < source.length && isAsciiWhitespace(source.charCodeAt(index)!)) {
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

    while (index < source.length && isAsciiWhitespace(source.charCodeAt(index)!)) {
      index += 1
    }
    if (source[index] !== '=') {
      return null
    }
    index += 1
    while (index < source.length && isAsciiWhitespace(source.charCodeAt(index)!)) {
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

export function parseAttributeDirectiveSource(
  source: string,
): { name: string, attributes: Record<string, string> } | null {
  if (!source.startsWith('::')) {
    return null
  }
  const brace = source.indexOf('{')
  if (brace < 3 || !source.endsWith('}')) {
    return null
  }
  const name = source.slice(2, brace)
  if (!/^[A-Z][\w-]*$/i.test(name)) {
    return null
  }
  const parsed = parseDirectiveAttributes(source, brace + 1)
  if (!parsed || parsed.endIndex !== source.length) {
    return null
  }
  return { name, attributes: parsed.attributes }
}

function tokenTypeFor(name: string): string {
  return `attributeDirective_${name.replace(/-/g, '_')}`
}

/**
 * micromark extension: treat complete `::name{attrs}` as an atomic text construct.
 * Incomplete / malformed forms fail the construct and stay plain text (streaming-safe).
 * Attribute interiors never pass through GFM autolink/emphasis.
 */
export function attributeDirectiveMicromark(
  options: RemarkAttributeDirectiveOptions,
): MicromarkExtension {
  const marker = `::${options.name}{`
  const tokenType = tokenTypeFor(options.name)
  const construct: Construct = {
    name: `attributeDirective:${options.name}`,
    tokenize: tokenizeAttributeDirective(marker, tokenType),
  }

  return {
    // 58 = `:` (colon) token code
    text: {
      58: construct,
    },
  }
}

/**
 * mdast compile helpers for a single attribute-directive token type.
 */
export function attributeDirectiveFromMarkdown(
  options: RemarkAttributeDirectiveOptions,
): FromMarkdownExtension {
  const tokenType = tokenTypeFor(options.name)
  const { name } = options

  return {
    enter: {
      [tokenType]: function enterAttributeDirective(this: CompileContext, token: Token) {
        this.enter(
          {
            type: name,
            data: {
              hName: name,
              hProperties: {},
            },
            children: [],
          } as never,
          token,
        )
      },
    },
    exit: {
      [tokenType]: function exitAttributeDirective(this: CompileContext, token: Token) {
        const source = this.sliceSerialize(token)
        const parsed = parseAttributeDirectiveSource(source)
        const node = this.stack.at(-1) as AttributeDirectiveNode | undefined
        if (parsed && node) {
          node.type = parsed.name
          node.data = {
            hName: parsed.name,
            hProperties: parsed.attributes,
          }
          node.children = []
        }
        this.exit(token)
      },
    },
  }
}

/**
 * First-class Cradle attribute-directive dialect for remark/react-markdown.
 *
 * - micromark tokenizes complete `::name{...}` forms atomically (beats GFM autolink)
 * - incomplete forms remain plain text for lossless streaming
 * - leaf nodes are lifted out of paragraphs so custom elements can render as blocks
 */
export function createRemarkAttributeDirective(
  options: RemarkAttributeDirectiveOptions,
): Plugin<[], Root> {
  const { name } = options
  const micromark = attributeDirectiveMicromark(options)
  const fromMarkdown = attributeDirectiveFromMarkdown(options)

  return function remarkAttributeDirective(this: Processor) {
    // When used via unified/react-markdown, register micromark + mdast extensions.
    // When invoked as a plain transform (tests / direct calls), only run the lift pass.
    const data = this.data() as {
      micromarkExtensions?: MicromarkExtension[]
      fromMarkdownExtensions?: Array<FromMarkdownExtension | FromMarkdownExtension[]>
    }

    if (data) {
      const micromarkExtensions = (data.micromarkExtensions ||= [])
      const fromMarkdownExtensions = (data.fromMarkdownExtensions ||= [])
      micromarkExtensions.push(micromark)
      fromMarkdownExtensions.push(fromMarkdown)
    }

    return (tree: Root) => {
      liftAttributeDirectives(tree, name)
    }
  }
}

function tokenizeAttributeDirective(marker: string, tokenType: string) {
  return function tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
    let markerIndex = 0

    return start

    function start(code: Code): State | undefined {
      if (code !== 58 /* colon */) {
        return nok(code)
      }
      effects.enter(tokenType as never)
      effects.consume(code)
      markerIndex = 1
      return inMarker
    }

    function inMarker(code: Code): State | undefined {
      if (code === null || code < 0) {
        return nok(code)
      }
      if (code !== marker.charCodeAt(markerIndex)) {
        return nok(code)
      }
      effects.consume(code)
      markerIndex += 1
      if (markerIndex === marker.length) {
        return inAttributes
      }
      return inMarker
    }

    function inAttributes(code: Code): State | undefined {
      if (code === null || code < 0) {
        return nok(code)
      }

      if (isAsciiWhitespace(code)) {
        effects.consume(code)
        return inAttributes
      }

      if (code === 125 /* } */) {
        effects.consume(code)
        effects.exit(tokenType as never)
        return ok
      }

      if (!isNameStart(code)) {
        return nok(code)
      }
      effects.consume(code)
      return inKey
    }

    function inKey(code: Code): State | undefined {
      if (code !== null && code >= 0 && isNameContinue(code)) {
        effects.consume(code)
        return inKey
      }
      return afterKey(code)
    }

    function afterKey(code: Code): State | undefined {
      if (code === null || code < 0) {
        return nok(code)
      }
      if (isAsciiWhitespace(code)) {
        effects.consume(code)
        return afterKey
      }
      if (code !== 61 /* = */) {
        return nok(code)
      }
      effects.consume(code)
      return afterEq
    }

    function afterEq(code: Code): State | undefined {
      if (code === null || code < 0) {
        return nok(code)
      }
      if (isAsciiWhitespace(code)) {
        effects.consume(code)
        return afterEq
      }
      if (code === 34 /* " */) {
        effects.consume(code)
        return inQuotedValue
      }
      if (code === 125 /* } */ || isAsciiWhitespace(code)) {
        return nok(code)
      }
      effects.consume(code)
      return inBareValue
    }

    function inQuotedValue(code: Code): State | undefined {
      if (code === null || code < 0) {
        return nok(code)
      }
      if (code === 92 /* \ */) {
        effects.consume(code)
        return inQuotedEscape
      }
      if (code === 34 /* " */) {
        effects.consume(code)
        return inAttributes
      }
      effects.consume(code)
      return inQuotedValue
    }

    function inQuotedEscape(code: Code): State | undefined {
      if (code === null || code < 0) {
        return nok(code)
      }
      effects.consume(code)
      return inQuotedValue
    }

    function inBareValue(code: Code): State | undefined {
      if (code === null || code < 0) {
        return nok(code)
      }
      if (code === 125 /* } */ || isAsciiWhitespace(code)) {
        return inAttributes(code)
      }
      effects.consume(code)
      return inBareValue
    }
  }
}

/**
 * Lift leaf attribute-directive nodes out of paragraphs so they can render as
 * block-level custom elements (cards) without invalid nested phrasing HTML.
 */
function liftAttributeDirectives(tree: Root, name: string) {
  visit(tree, 'paragraph', (node, index, parent) => {
    if (!parent || typeof index !== 'number') {
      return
    }

    const children = node.children as PhrasingContent[]
    let hasDirective = false
    for (const child of children) {
      if (child.type === name) {
        hasDirective = true
        break
      }
    }
    if (!hasDirective) {
      return
    }

    const replacement: RootContent[] = []
    let buffer: PhrasingContent[] = []

    const flushBuffer = () => {
      const trimmed = trimParagraphChildren(buffer)
      if (trimmed.length > 0) {
        const paragraph: Paragraph = { type: 'paragraph', children: trimmed }
        replacement.push(paragraph)
      }
      buffer = []
    }

    for (const child of children) {
      if (child.type === name) {
        flushBuffer()
        replacement.push(child as unknown as BlockContent)
        continue
      }
      buffer.push(child)
    }
    flushBuffer()

    parent.children.splice(index, 1, ...replacement)
    return [SKIP, index + replacement.length]
  })
}

function trimParagraphChildren(children: PhrasingContent[]): PhrasingContent[] {
  let start = 0
  let end = children.length

  while (start < end && isTrimmableBoundary(children[start]!)) {
    start += 1
  }
  while (end > start && isTrimmableBoundary(children[end - 1]!)) {
    end -= 1
  }

  if (start === 0 && end === children.length) {
    return children
  }
  return children.slice(start, end)
}

function isTrimmableBoundary(node: PhrasingContent): boolean {
  if (node.type === 'text') {
    return node.value.trim().length === 0
  }
  return node.type === 'break'
}

function isAsciiWhitespace(code: number): boolean {
  return (
    code === 32
    || /* space */ code === 9
    || /* tab */ code === 10
    || /* lf */ code === 11
    || /* vt */ code === 12
    || /* ff */ code === 13
  ) /* cr */
}

function isNameStart(code: number): boolean {
  return (code >= 65 && code <= 90) /* A-Z */ || (code >= 97 && code <= 122) /* a-z */
}

function isNameContinue(code: number): boolean {
  return (
    isNameStart(code) || (code >= 48 && code <= 57) /* 0-9 */ || code === 45 /* - */ || code === 95
  ) /* _ */
}
