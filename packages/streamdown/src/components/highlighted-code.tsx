import * as React from 'react'
import { createContext, memo, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { Highlighter } from 'shiki'
import { createHighlighter } from 'shiki'

// Context to detect block vs inline code
const PreContext = createContext(false)

// Shared singleton highlighter
let highlighterPromise: Promise<Highlighter> | null = null
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: [
        'typescript',
        'javascript',
        'tsx',
        'jsx',
        'python',
        'rust',
        'go',
        'bash',
        'shell',
        'json',
        'html',
        'css',
        'scss',
        'markdown',
        'sql',
        'yaml',
        'toml',
        'java',
        'c',
        'cpp',
        'ruby',
        'php',
        'swift',
        'kotlin',
        'dockerfile',
        'plaintext',
      ],
    })
  }
  return highlighterPromise
}

const LANGUAGE_CLASS_RE = /language-(\w+)/
const TRAILING_NEWLINE_RE = /\n$/
const HIGHLIGHT_IDLE_TIMEOUT_MS = 1200

interface HighlightJob {
  canceled: boolean
  run: () => Promise<void>
}

type IdleGlobal = typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

const highlightQueue: HighlightJob[] = []
let highlightQueueScheduled = false

function requestIdleWork(callback: () => void): () => void {
  const idleGlobal = globalThis as IdleGlobal

  if (typeof idleGlobal.requestIdleCallback === 'function' && typeof idleGlobal.cancelIdleCallback === 'function') {
    const idleId = idleGlobal.requestIdleCallback(callback, { timeout: HIGHLIGHT_IDLE_TIMEOUT_MS })
    return () => idleGlobal.cancelIdleCallback?.(idleId)
  }

  const timeoutId = setTimeout(callback, 0)
  return () => clearTimeout(timeoutId)
}

function scheduleHighlightQueue(): void {
  if (highlightQueueScheduled || highlightQueue.length === 0) {
    return
  }

  highlightQueueScheduled = true
  requestIdleWork(() => {
    highlightQueueScheduled = false
    void runNextHighlightJob()
  })
}

async function runNextHighlightJob(): Promise<void> {
  const job = highlightQueue.shift()
  if (!job) {
    return
  }

  if (!job.canceled) {
    await job.run()
  }

  scheduleHighlightQueue()
}

function enqueueHighlightJob(run: () => Promise<void>): () => void {
  const job: HighlightJob = { canceled: false, run }
  highlightQueue.push(job)
  scheduleHighlightQueue()

  return () => {
    job.canceled = true
  }
}

// Language alias map
const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  sh: 'bash',
  zsh: 'bash',
  py: 'python',
  rb: 'ruby',
  yml: 'yaml',
  rs: 'rust',
  kt: 'kotlin',
  text: 'plaintext',
}

function normalizeLang(lang: string | undefined): string | undefined {
  if (!lang) {
    return undefined
  }
  const lower = lang.toLowerCase()
  return LANG_ALIASES[lower] ?? lower
}

// Display name for the language tag
const LANG_DISPLAY: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  tsx: 'TSX',
  jsx: 'JSX',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  bash: 'Bash',
  shell: 'Shell',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  markdown: 'Markdown',
  sql: 'SQL',
  yaml: 'YAML',
  toml: 'TOML',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  ruby: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  kotlin: 'Kotlin',
  dockerfile: 'Dockerfile',
  plaintext: 'Text',
}

function getDisplayName(lang: string | undefined): string | undefined {
  if (!lang) {
    return undefined
  }
  return LANG_DISPLAY[lang] ?? lang
}

// Copy icon SVG (inline to avoid external deps)
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

interface HighlightedCodeProps {
  children?: React.ReactNode
  className?: string
  node?: unknown
}

/**
 * Code component for ReactMarkdown.
 * - Inline code: renders as <code> with styling
 * - Fenced code blocks: Shiki-highlighted with copy button and language label
 */
export const HighlightedCode = memo<HighlightedCodeProps>(({ children, className, ...rest }) => {
  const insidePre = useContext(PreContext)
  const langMatch = className?.match(LANGUAGE_CLASS_RE)
  // It's a block if we're inside a <pre> wrapper OR if there's a language class
  const isBlock = insidePre || !!langMatch

  if (!isBlock) {
    return (
      <code className="sd-inline-code" {...rest}>
        {children}
      </code>
    )
  }

  const rawLang = langMatch?.[1]
  const lang = normalizeLang(rawLang)
  const code = extractText(children)

  return <FencedCodeBlock code={code} language={lang} className={className} />
})

HighlightedCode.displayName = 'HighlightedCode'

// Extract text content from React children
function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') {
    return children
  }
  if (Array.isArray(children)) {
    return children.map(extractText).join('')
  }
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as { props: { children?: React.ReactNode } }).props.children)
  }
  return String(children ?? '')
}

interface FencedCodeBlockProps {
  code: string
  language: string | undefined
  className?: string
}

const FencedCodeBlock = memo<FencedCodeBlockProps>(({ code, language }) => {
  const [html, setHtml] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const lastCodeRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (code === lastCodeRef.current) {
      return
    }
    lastCodeRef.current = code
    setHtml('')

    const cancelHighlight = enqueueHighlightJob(async () => {
      const highlighter = await getHighlighter()
      const resolved = language && highlighter.getLoadedLanguages().includes(language) ? language : 'plaintext'
      const result = highlighter.codeToHtml(code.replace(TRAILING_NEWLINE_RE, ''), {
        lang: resolved,
        themes: { dark: 'github-dark', light: 'github-light' },
      })
      if (lastCodeRef.current === code) {
        setHtml(result)
      }
    })

    return cancelHighlight
  }, [code, language])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        setCopied(false)
        timerRef.current = null
      }, 1500)
    })
  }, [code])

  const displayLang = getDisplayName(language)
  const hasLang = !!displayLang

  return (
    <div className={`sd-code-block${hasLang ? '' : ' sd-code-block--no-lang'}`}>
      {hasLang && (
        <div className="sd-code-header">
          <span className="sd-code-lang">{displayLang}</span>
          <button
            type="button"
            className="sd-code-copy"
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy code'}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      )}
      {!hasLang && (
        <button
          type="button"
          className="sd-code-copy sd-code-copy--floating"
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      )}
      <div className="sd-code-body">
        {html
          ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          )
          : (
            <pre><code>{code}</code></pre>
          )}
      </div>
    </div>
  )
})

FencedCodeBlock.displayName = 'FencedCodeBlock'

/**
 * Pre component override — provides context so HighlightedCode knows
 * it's inside a code block, and strips the wrapper <pre> since
 * our FencedCodeBlock handles its own layout.
 */
export function HighlightedPre({ children }: { children?: React.ReactNode }) {
  return <PreContext.Provider value={true}>{children}</PreContext.Provider>
}
