import CodeBlock from '@tiptap/extension-code-block'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { BundledLanguage } from 'shiki'

import { CodeBlockView } from './code-block-view'
import type { ShikiHighlighter } from './shiki-highlighter'
import { DARK_THEME, getHighlighter, getLoadedHighlighter, LIGHT_THEME, normalizeLanguage } from './shiki-highlighter'

/* ─── Decoration builder ─────────────────────────────────── */

const pluginKey = new PluginKey('shikiHighlight')

function isDark(): boolean {
  return document.documentElement.classList.contains('dark')
}

function hasCodeBlock(doc: ProseMirrorNode): boolean {
  let found = false
  doc.descendants((node) => {
    if (node.type.name === 'codeBlock') {
      found = true
      return false
    }
  })
  return found
}

function buildDecorations(doc: ProseMirrorNode, highlighter: ShikiHighlighter): DecorationSet {
  const decorations: Decoration[] = []
  const theme = isDark() ? DARK_THEME : LIGHT_THEME

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') {
      return
    }
    const language = normalizeLanguage(node.attrs.language as string | null)
    const code = node.textContent

    if (!code) {
      return
    }

    const loaded = highlighter.getLoadedLanguages()
    if (!loaded.includes(language) && language !== 'plaintext') {
      return
    }

    const { tokens } = highlighter.codeToTokens(code, { lang: language as BundledLanguage, theme })

    let lineOffset = pos + 1
    for (const line of tokens) {
      let charOffset = lineOffset
      for (const token of line) {
        const from = charOffset
        const to = from + token.content.length

        if (token.color) {
          decorations.push(
            Decoration.inline(from, to, {
              style: `color: ${token.color}`,
            }),
          )
        }
        charOffset = to
      }
      lineOffset = charOffset + 1
    }
  })

  return DecorationSet.create(doc, decorations)
}

const LANG_CLASS_RE = /language-(\w+)/

/* ─── Extension ──────────────────────────────────────────── */

export const ShikiCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const classAttr = element.firstElementChild?.getAttribute('class') ?? ''
          const match = LANG_CLASS_RE.exec(classAttr)
          return match ? match[1] : null
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.language) {
            return {}
          }
          return { class: `language-${attributes.language}` }
        },
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },

  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? []

    const shikiPlugin = new Plugin({
      key: pluginKey,
      state: {
        init: () => {
          return DecorationSet.empty
        },
        apply: (tr, oldState) => {
          const meta = tr.getMeta(pluginKey) as { type: 'loaded' | 'theme-changed', highlighter: ShikiHighlighter } | undefined
          if (meta?.type === 'loaded' || meta?.type === 'theme-changed') {
            return buildDecorations(tr.doc, meta.highlighter)
          }
          const highlighter = getLoadedHighlighter()
          if (tr.docChanged && highlighter) {
            return buildDecorations(tr.doc, highlighter)
          }
          if (!tr.docChanged) {
            return oldState
          }
          return oldState.map(tr.mapping, tr.doc)
        },
      },
      props: {
        decorations(state) {
          return this.getState(state)
        },
      },
      view(editorView) {
        let requested = false
        const requestHighlightLoad = () => {
          if (requested || !hasCodeBlock(editorView.state.doc)) {
            return
          }
          requested = true
          void getHighlighter().then((highlighter) => {
            const { state } = editorView
            const tr = state.tr.setMeta(pluginKey, { type: 'loaded', highlighter })
            editorView.dispatch(tr)
          })
        }

        requestHighlightLoad()

        return {
          update() {
            requestHighlightLoad()
          },
        }
      },
    })

    return [...parentPlugins, shikiPlugin]
  },
})
