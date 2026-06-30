/**
 * Quick question composer slot UI.
 *
 * This is a chat-owned slash-opened composer rail for `/btw`, not a modal or
 * persisted message surface.
 */
import { Streamdown } from '@cradle/streamdown'
import type { UIMessageChunk } from 'ai'
import { parseJsonEventStream, uiMessageChunkSchema } from 'ai'
import {
  WarningLine as AlertTriangleIcon,
  QuestionLine as MessageCircleQuestionIcon,
  CloseLine as XIcon
} from '@mingcute/react'

import { Spinner } from '~/components/ui/spinner'
import type { AnchorHTMLAttributes } from 'react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '~/lib/cn'
import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import { MarkdownFileLink } from '../../rendering/markdown-file-link'
import { ComposerSlotIconAction, ComposerSlotShell } from './composer-slot-shell'
import type { ComposerQuickQuestionSlotActions } from './types'

const QUICK_QUESTION_ANIMATION_MAX_CHARS = 4000

export function QuickQuestionSlotState({
  quickQuestion,
  className,
}: {
  quickQuestion: ComposerQuickQuestionSlotActions
  className?: string
}) {
  const [content, setContent] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const question = quickQuestion.question.trim()

  useEffect(() => {
    if (!quickQuestion.open || !quickQuestion.sessionId || !question) {
      return
    }

    const abortController = new AbortController()
    setContent('')
    setErrorText(null)
    setStreaming(true)

    void streamQuickQuestion({
      apiBaseUrl: quickQuestion.apiBaseUrl,
      question,
      sessionId: quickQuestion.sessionId,
      signal: abortController.signal,
      onTextDelta: delta => setContent(prev => prev + delta),
    })
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        setErrorText(error instanceof Error ? error.message : 'Failed to stream quick question.')
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setStreaming(false)
        }
      })

    return () => abortController.abort()
  }, [quickQuestion.apiBaseUrl, quickQuestion.open, quickQuestion.sessionId, question])

  useEffect(() => {
    const contentElement = contentRef.current
    if (!contentElement) {
      return
    }
    contentElement.scrollTop = contentElement.scrollHeight
  }, [content])

  if (!quickQuestion.open || !question) {
    return null
  }

  return (
    <ComposerSlotShell stateName="quick-question" testId="quick-question-slot" className={cn('py-2', className)}>
      <div className="mb-2 flex h-6 min-w-0 items-center gap-2">
        <MessageCircleQuestionIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="shrink-0 font-medium text-foreground/80">Quick question</span>
          <span className="min-w-0 truncate text-muted-foreground">{question}</span>
        </div>
        {streaming && (
          <Spinner className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden="true" />
        )}
        <ComposerSlotIconAction label="Close quick question" onClick={quickQuestion.onDismiss}>
          <XIcon className="size-3.5" aria-hidden="true" />
        </ComposerSlotIconAction>
      </div>

      {errorText
        ? (
            <div className="flex min-w-0 items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
              <AlertTriangleIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{errorText}</span>
            </div>
          )
        : (
            <div
              ref={contentRef}
              className="max-h-56 overflow-y-auto rounded-md"
            >
              {content
                ? (
                    <div className="streamdown-root text-xs leading-relaxed text-foreground/90">
                      <Streamdown
                        content={content}
                        streaming={streaming}
                        animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset}
                        animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode}
                        showCursor={STREAMDOWN_RENDER_OPTIONS.showCursor}
                        animated={content.length <= QUICK_QUESTION_ANIMATION_MAX_CHARS}
                        components={{
                          a: props => <MarkdownFileLink {...readMarkdownAnchorProps(props)} sessionId={quickQuestion.sessionId} />,
                        }}
                      />
                    </div>
                  )
                : (
                    <div className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
                      <Spinner className="size-3.5" aria-hidden="true" />
                      <span>Thinking</span>
                    </div>
                  )}
            </div>
          )}
    </ComposerSlotShell>
  )
}

function readMarkdownAnchorProps(value: unknown): AnchorHTMLAttributes<HTMLAnchorElement> {
  return value && typeof value === 'object'
    ? value as AnchorHTMLAttributes<HTMLAnchorElement>
    : {}
}

async function streamQuickQuestion({
  apiBaseUrl,
  question,
  sessionId,
  signal,
  onTextDelta,
}: {
  apiBaseUrl?: string
  question: string
  sessionId: string
  signal: AbortSignal
  onTextDelta: (delta: string) => void
}) {
  const response = await fetch(buildQuickQuestionUrl(apiBaseUrl, sessionId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
    signal,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Quick question failed: ${response.status}${body ? ` ${body}` : ''}`)
  }
  if (!response.body) {
    throw new Error('Quick question stream is empty.')
  }

  await readQuickQuestionChunks(response.body, onTextDelta)
}

function buildQuickQuestionUrl(apiBaseUrl: string | undefined, sessionId: string): string {
  const path = `/chat/sessions/${encodeURIComponent(sessionId)}/quick-question`
  return apiBaseUrl ? new URL(path, apiBaseUrl).toString() : path
}

async function readQuickQuestionChunks(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (delta: string) => void,
): Promise<void> {
  const reader = parseJsonEventStream({
    stream: body,
    schema: uiMessageChunkSchema,
  }).getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (!value.success) {
        throw value.error
      }
      readQuickQuestionChunk(value.value, onTextDelta)
    }
  }
  finally {
    reader.releaseLock()
  }
}

function readQuickQuestionChunk(chunk: UIMessageChunk, onTextDelta: (delta: string) => void): void {
  if (chunk.type === 'text-delta') {
    onTextDelta(chunk.delta)
  }
  if (chunk.type === 'error') {
    throw new Error(chunk.errorText)
  }
}
