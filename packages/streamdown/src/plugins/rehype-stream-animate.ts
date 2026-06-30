import type { Element, ElementContent, Root, Text } from 'hast'
import type { Plugin } from 'unified'
import { SKIP, visit } from 'unist-util-visit'

export interface RehypeStreamAnimateOptions {
  /** Per-char birth timestamps (persistent, only grows) */
  births?: number[]
  /** Fade animation duration in ms */
  fadeDuration?: number
  /** Current render timestamp (performance.now or Date.now) */
  nowMs?: number
  /** If true, all chars are revealed immediately (no animation) */
  revealed?: boolean
  /** Animation mode */
  mode?: 'char' | 'word'
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'td', 'th'])
const SKIP_TAGS = new Set(['pre', 'code', 'table', 'svg', 'math'])

function hasClass(node: Element, cls: string): boolean {
  return String(node.properties?.className ?? '').includes(cls)
}

/**
 * Rehype plugin that wraps text nodes in animated spans.
 *
 * Key design (from Lobe):
 * - Accepts a `births` array of per-char timestamps (assigned once, never changes)
 * - At render time, compares each char's birth to `nowMs`:
 *   - If birth + fadeDuration <= nowMs → char is fully revealed (class only, no animation)
 *   - If birth <= nowMs < birth + fadeDuration → char is mid-fade (negative animation-delay)
 *   - If birth > nowMs → char hasn't started yet (positive animation-delay)
 * - This means re-renders DON'T restart animations because delays are absolute
 */
const rehypeStreamAnimate: Plugin<[RehypeStreamAnimateOptions], Root> = (options) => {
  const {
    births,
    fadeDuration = 280,
    nowMs,
    revealed = false,
    mode = 'word',
  } = options

  const hasBirths = !revealed && births !== undefined && nowMs !== undefined

  return (tree) => {
    let globalCharIndex = 0

    const shouldSkip = (node: Element): boolean => {
      return SKIP_TAGS.has(node.tagName) || hasClass(node, 'katex')
    }

    const createCharSpan = (char: string, charIndex: number): Element => {
      if (revealed) {
        return {
          type: 'element',
          tagName: 'span',
          properties: { className: 'stream-char stream-char-revealed' },
          children: [{ type: 'text', value: char }],
        }
      }

      if (hasBirths) {
        const birthTs = births![charIndex]
        if (birthTs === undefined) {
          return {
            type: 'element',
            tagName: 'span',
            properties: { className: 'stream-char stream-char-revealed' },
            children: [{ type: 'text', value: char }],
          }
        }

        const elapsed = (nowMs as number) - birthTs
        if (elapsed >= fadeDuration) {
          return {
            type: 'element',
            tagName: 'span',
            properties: { className: 'stream-char stream-char-revealed' },
            children: [{ type: 'text', value: char }],
          }
        }

        const delay = -(elapsed)
        return {
          type: 'element',
          tagName: 'span',
          properties: {
            className: 'stream-char',
            style: `animation-delay:${delay}ms`,
          },
          children: [{ type: 'text', value: char }],
        }
      }

      return {
        type: 'element',
        tagName: 'span',
        properties: { className: 'stream-char stream-char-revealed' },
        children: [{ type: 'text', value: char }],
      }
    }

    const createWordSpan = (word: string, wordStartIndex: number): Element => {
      if (revealed) {
        return {
          type: 'element',
          tagName: 'span',
          properties: { className: 'stream-word stream-word-revealed' },
          children: [{ type: 'text', value: word }],
        }
      }

      if (hasBirths) {
        const birthTs = births![wordStartIndex]
        if (birthTs === undefined) {
          return {
            type: 'element',
            tagName: 'span',
            properties: { className: 'stream-word stream-word-revealed' },
            children: [{ type: 'text', value: word }],
          }
        }

        const elapsed = (nowMs as number) - birthTs
        if (elapsed >= fadeDuration) {
          return {
            type: 'element',
            tagName: 'span',
            properties: { className: 'stream-word stream-word-revealed' },
            children: [{ type: 'text', value: word }],
          }
        }

        const delay = -(elapsed)
        return {
          type: 'element',
          tagName: 'span',
          properties: {
            className: 'stream-word',
            style: `animation-delay:${delay}ms`,
          },
          children: [{ type: 'text', value: word }],
        }
      }

      return {
        type: 'element',
        tagName: 'span',
        properties: { className: 'stream-word stream-word-revealed' },
        children: [{ type: 'text', value: word }],
      }
    }

    const wrapChars = (text: string): ElementContent[] => {
      const spans: ElementContent[] = []
      for (const char of text) {
        spans.push(createCharSpan(char, globalCharIndex))
        globalCharIndex++
      }
      return spans
    }

    const wrapWords = (text: string): ElementContent[] => {
      const segments = segmentText(text)
      const spans: ElementContent[] = []
      for (const seg of segments) {
        if (seg.isWhitespace) {
          for (const _c of seg.value) {
            globalCharIndex++
          }
          spans.push({ type: 'text', value: seg.value })
        }
        else {
          const wordStartIndex = globalCharIndex
          for (const _c of seg.value) {
            globalCharIndex++
          }
          spans.push(createWordSpan(seg.value, wordStartIndex))
        }
      }
      return spans
    }

    const wrapTextNode = (text: string): ElementContent[] => {
      if (mode === 'char') {
        return wrapChars(text)
      }
      return wrapWords(text)
    }

    const processElement = (node: Element) => {
      const newChildren: ElementContent[] = []
      for (const child of node.children) {
        if (child.type === 'text') {
          const text = (child as Text).value
          if (!text) {
            newChildren.push(child)
            continue
          }
          newChildren.push(...wrapTextNode(text))
        }
        else if (child.type === 'element') {
          if (!shouldSkip(child as Element)) {
            processElement(child as Element)
          }
          newChildren.push(child)
        }
        else {
          newChildren.push(child)
        }
      }
      node.children = newChildren
    }

    visit(tree, 'element', (node) => {
      if (shouldSkip(node as Element)) {
        return SKIP
      }
      if (BLOCK_TAGS.has((node as Element).tagName)) {
        processElement(node as Element)
        return SKIP
      }
    })
  }
}

// --- Word segmentation ---

const WHITESPACE_ONLY = /^\s+$/
const WHITESPACE_SPLIT = /(\s+)/

interface WordSegment {
  value: string
  isWhitespace: boolean
}

function segmentText(text: string): WordSegment[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
      const segments: WordSegment[] = []
      for (const seg of segmenter.segment(text)) {
        segments.push({
          value: seg.segment,
          isWhitespace: WHITESPACE_ONLY.test(seg.segment),
        })
      }
      return segments
    }
 catch {
      // Fall through
    }
  }

  const segments: WordSegment[] = []
  const parts = text.split(WHITESPACE_SPLIT)
  for (const part of parts) {
    if (part === '') {
      continue
    }
    segments.push({
      value: part,
      isWhitespace: WHITESPACE_ONLY.test(part),
    })
  }
  return segments
}

export default rehypeStreamAnimate
