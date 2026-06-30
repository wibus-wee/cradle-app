import * as React from 'react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { Highlighter } from 'shiki'
import { createHighlighter } from 'shiki'

const STREAMING_HIGHLIGHT_THROTTLE_MS = 150

interface CodeBlockStreamingProps {
  code: string
  language?: string
  streaming: boolean
  birthTime: number
  state: 'queued' | 'streaming' | 'animating' | 'revealed'
}

// Shared highlighter singleton
let highlighterPromise: Promise<Highlighter> | null = null
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: ['typescript', 'javascript', 'python', 'rust', 'go', 'bash', 'json', 'html', 'css', 'markdown', 'sql', 'yaml', 'toml', 'tsx', 'jsx', 'java', 'c', 'cpp', 'ruby', 'php', 'swift', 'kotlin'],
    })
  }
  return highlighterPromise
}

/**
 * Code block with throttled highlighting during streaming.
 * During streaming: re-highlights at most every STREAMING_HIGHLIGHT_THROTTLE_MS.
 * After streaming ends: one final highlight pass.
 */
const CodeBlockStreaming = memo<CodeBlockStreamingProps>(({ code, language, streaming, birthTime, state }) => {
  const [html, setHtml] = useState('')
  const lastHighlightTime = useRef(0)
  const lastHighlightedCode = useRef('')
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const highlight = useCallback((codeToHighlight: string) => {
    if (codeToHighlight === lastHighlightedCode.current) {
      return
    }
    lastHighlightedCode.current = codeToHighlight
    lastHighlightTime.current = Date.now()

    getHighlighter().then((highlighter) => {
      if (!mountedRef.current) {
        return
      }
      const lang = language && highlighter.getLoadedLanguages().includes(language) ? language : 'text'
      const result = highlighter.codeToHtml(codeToHighlight, {
        lang,
        themes: { dark: 'github-dark', light: 'github-light' },
      })
      setHtml(result)
    })
  }, [language])

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    if (state === 'queued') {
      return
    }

    if (!streaming || state === 'revealed') {
      // Final pass: highlight immediately
      if (pendingRef.current) {
        clearTimeout(pendingRef.current)
        pendingRef.current = null
      }
      highlight(code)
      return
    }

    // Throttled during streaming
    const elapsed = Date.now() - lastHighlightTime.current
    if (elapsed >= STREAMING_HIGHLIGHT_THROTTLE_MS) {
      highlight(code)
    }
 else if (!pendingRef.current) {
      timeoutId = setTimeout(() => {
        pendingRef.current = null
        highlight(code)
      }, STREAMING_HIGHLIGHT_THROTTLE_MS - elapsed)
      pendingRef.current = timeoutId
    }

    return () => {
      if (timeoutId && pendingRef.current === timeoutId) {
        clearTimeout(timeoutId)
        pendingRef.current = null
      }
    }
  }, [code, streaming, state, highlight])

  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current)
      }
    }
  }, [])

  if (state === 'queued') {
    return null
  }

  return (
    <div
      data-birth={birthTime}
      data-state={state}
      data-pre-mounted={state === 'revealed' ? '' : undefined}
      className="stream-code-block"
    >
      {html
? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      )
: (
        <pre><code>{code}</code></pre>
      )}
    </div>
  )
}, (prev, next) => prev.code === next.code && prev.state === next.state && prev.streaming === next.streaming)

CodeBlockStreaming.displayName = 'CodeBlockStreaming'
export { CodeBlockStreaming }
export type { CodeBlockStreamingProps }
