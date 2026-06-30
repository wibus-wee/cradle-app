import * as React from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import type { Highlighter } from 'shiki'
import { createHighlighter } from 'shiki'

interface CodeBlockProps {
  code: string
  language?: string
  state: 'queued' | 'streaming' | 'animating' | 'revealed'
  birthTime: number
}

// Shared highlighter instance (singleton)
let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: ['typescript', 'javascript', 'python', 'rust', 'go', 'bash', 'json', 'html', 'css', 'markdown', 'sql', 'yaml', 'toml'],
    })
  }
  return highlighterPromise
}

const CodeBlock = memo<CodeBlockProps>(({ code, language, state, birthTime }) => {
  const [html, setHtml] = useState<string>('')
  const lastCodeRef = useRef('')

  useEffect(() => {
    if (state === 'queued') {
      return
    }
    // Only re-highlight if code actually changed
    if (code === lastCodeRef.current) {
      return
    }
    lastCodeRef.current = code

    getHighlighter().then((highlighter) => {
      const lang = language && highlighter.getLoadedLanguages().includes(language) ? language : 'text'
      const result = highlighter.codeToHtml(code, {
        lang,
        themes: { dark: 'github-dark', light: 'github-light' },
      })
      setHtml(result)
    })
  }, [code, language, state])

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
}, (prev, next) => prev.code === next.code && prev.state === next.state)

CodeBlock.displayName = 'StreamCodeBlock'
export { CodeBlock }
export type { CodeBlockProps }
