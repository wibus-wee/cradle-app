// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import type { UIMessage } from 'ai'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TooltipProvider } from '~/components/ui/tooltip'
import { useChatStore } from '~/store/chat'

import { MessageBubbleById } from './message-bubble-by-id'

const fullMessage: UIMessage = {
  id: 'visible',
  role: 'assistant' as const,
  parts: [
    { type: 'text', text: 'Full durable text' },
    {
      type: 'tool-test',
      toolCallId: 'tool-visible',
      state: 'output-available',
      input: { path: 'README.md' },
      output: { ok: true },
    },
  ],
}

function shellMessage(id: string): UIMessage {
  return {
    id,
    role: 'assistant' as const,
    parts: [{ type: 'text', text: `Preview ${id}` }],
    metadata: { cradle: { historyShell: true, previewTruncated: false } },
  }
}

function renderMessage(messageId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<MessageBubbleById sessionId="session-a" messageId={messageId} />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    ),
  })
}

describe('messageBubbleById history shells', () => {
  beforeEach(() => {
    useChatStore.getState().clearSession('session-a')
  })

  afterEach(() => {
    cleanup()
    useChatStore.getState().clearSession('session-a')
  })

  it('paints text-only history shells without tool activity', () => {
    useChatStore.getState().setMessages('session-a', [shellMessage('visible')])
    renderMessage('visible')
    expect(screen.getByText('Preview visible')).toBeTruthy()
    expect(screen.queryByTestId('chat-tool-call-tool-visible')).toBeNull()
  })

  it('renders text and tools together from a full message', () => {
    useChatStore.getState().setMessages('session-a', [fullMessage])
    renderMessage('visible')
    expect(screen.getByText('Full durable text')).toBeTruthy()
    expect(screen.getByTestId('chat-activity-feed')).toBeTruthy()
  })
})
