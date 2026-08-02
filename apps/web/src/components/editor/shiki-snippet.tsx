import { useEffect, useState } from 'react'
import type { BundledLanguage } from 'shiki'

import { cn } from '~/lib/cn'

import {
  DARK_THEME,
  getHighlighter,
  LIGHT_THEME,
  loadLanguage,
  normalizeLanguage,
} from './shiki-highlighter'

export interface ShikiSnippetProps {
  code: string
  language?: string | null
  /** When false, keep a single horizontal line layout (`white-space: pre`). Default true. */
  wrap?: boolean
  className?: string
  /** Classes for the plain-text fallback while highlighting loads or fails. */
  fallbackClassName?: string
}

/**
 * Read-only Shiki-highlighted code snippet for non-editor surfaces
 * (await cards, previews, tool payloads). Shares the lazy highlighter with
 * the Markdown editor and dual-theme CSS via `.tool-call-code-highlight`.
 */
export function ShikiSnippet({
  code,
  language,
  wrap = true,
  className,
  fallbackClassName,
}: ShikiSnippetProps) {
  const [html, setHtml] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setHtml('')
    setFailed(false)

    async function renderHighlightedCode() {
      const normalized = normalizeLanguage(language)
      const loaded = await loadLanguage(normalized)
      const highlighter = await getHighlighter()
      const lang = loaded ? normalized : 'plaintext'
      const highlighted = highlighter.codeToHtml(code, {
        lang: lang as BundledLanguage,
        themes: { dark: DARK_THEME, light: LIGHT_THEME },
      })
      if (!cancelled) {
        setHtml(highlighted)
      }
    }

    void renderHighlightedCode().catch(() => {
      if (!cancelled) {
        setFailed(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [code, language])

  const showFallback = !html || failed

  return (
    <div
      className={cn(
        'tool-call-code-highlight font-mono text-[12px] leading-relaxed',
        className,
      )}
      data-wrap={wrap ? 'true' : 'false'}
    >
      {!showFallback && (
        // Shiki generates escaped token markup from plain text.
        // eslint-disable-next-line react-dom/no-dangerously-set-innerhtml
        <div dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {showFallback && (
        <pre className={cn('m-0 overflow-auto p-2.5 text-foreground', fallbackClassName)}>
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
