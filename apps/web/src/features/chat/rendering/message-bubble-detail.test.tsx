import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UIMessage } from 'ai'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatStore } from '~/store/chat'

import { MessageBubbleById } from '../transcript/containers/message-bubble-by-id'

const sdkMocks = vi.hoisted(() => ({
  getChatSessionsBySessionIdMessages: vi.fn(),
  getChatSessionsBySessionIdMessagesByMessageId: vi.fn(),
}))

vi.mock('~/api-gen/sdk.gen', async importOriginal => ({
  ...await importOriginal<typeof import('~/api-gen/sdk.gen')>(),
  ...sdkMocks,
}))

const detailMessage = {
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
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

describe('messageBubbleById detail hydration', () => {
  beforeEach(() => {
    useChatStore.getState().clearSession('session-a')
    useChatStore.getState().setMessages('session-a', [shellMessage('visible'), shellMessage('offscreen')])
    sdkMocks.getChatSessionsBySessionIdMessagesByMessageId.mockResolvedValue({
      data: { message: detailMessage },
    })
  })

  afterEach(() => {
    cleanup()
    useChatStore.getState().clearSession('session-a')
    vi.clearAllMocks()
  })

  it('hydrates only its mounted shell row with the exact detail payload', async () => {
    renderMessage('visible')

    await waitFor(() => {
      expect(sdkMocks.getChatSessionsBySessionIdMessagesByMessageId).toHaveBeenCalledWith(expect.objectContaining({
        path: { sessionId: 'session-a', messageId: 'visible' },
        signal: expect.any(AbortSignal),
        throwOnError: true,
      }))
    })
    expect(sdkMocks.getChatSessionsBySessionIdMessagesByMessageId).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(useChatStore.getState().messagesMap.get('session-a')).toEqual([
        detailMessage,
        shellMessage('offscreen'),
      ])
    })
    expect(screen.queryByTestId('chat-tool-call-tool-visible')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show execution details' }))
    expect(screen.getByTestId('chat-tool-call-tool-visible')).toBeTruthy()
  })
})
