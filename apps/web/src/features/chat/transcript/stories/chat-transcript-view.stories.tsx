import type { Meta, StoryObj } from '@storybook/react-vite'
import type { UIMessage } from 'ai'

import {
  chatTranscriptFixture,
  streamingChatTranscriptFixture,
} from '../fixtures/chat-transcript-fixtures'
import { ChatTranscriptView } from '../views/chat-transcript-view'
import { MessageBubbleView } from '../views/message-bubble-view'

interface TranscriptSceneProps {
  messages: UIMessage[]
  status: 'idle' | 'streaming' | 'error'
  isReady: boolean
  error?: string
  streamingMessageId?: string
}

function TranscriptScene({
  messages,
  status,
  isReady,
  error,
  streamingMessageId,
}: TranscriptSceneProps) {
  function renderMessage(message: UIMessage) {
    return (
      <div className="py-2.5">
        <MessageBubbleView
          message={message}
          isStreaming={message.id === streamingMessageId}
        />
      </div>
    )
  }

  return (
    <div className="h-screen min-h-[640px] bg-background">
      <ChatTranscriptView
        messages={messages}
        renderMessage={renderMessage}
        status={status}
        error={error}
        isReady={isReady}
        emptyLabel="Start a conversation"
        errorFallbackLabel="Messages could not be loaded"
      />
    </div>
  )
}

const meta = {
  title: 'Chat/Transcript/ChatTranscriptView',
  component: TranscriptScene,
  parameters: {
    docs: {
      description: {
        component: 'Fixture-driven transcript surface. It does not require a server, route, query client, session store, or Electron host.',
      },
    },
  },
  args: {
    messages: chatTranscriptFixture,
    status: 'idle',
    isReady: true,
  },
} satisfies Meta<typeof TranscriptScene>

export default meta

type Story = StoryObj<typeof meta>

export const LongThread: Story = {}

export const Streaming: Story = {
  args: {
    messages: streamingChatTranscriptFixture,
    status: 'streaming',
    streamingMessageId: 'assistant-streaming-answer',
  },
}

export const Empty: Story = {
  args: {
    messages: [],
  },
}

export const ErrorState: Story = {
  args: {
    status: 'error',
    error: 'The transcript fixture failed to load.',
  },
}
