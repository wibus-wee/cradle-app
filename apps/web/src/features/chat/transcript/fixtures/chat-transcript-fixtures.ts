import type { UIMessage } from 'ai'

export const chatTranscriptFixture: UIMessage[] = [
  {
    id: 'user-architecture-question',
    role: 'user',
    parts: [{
      type: 'text',
      text: 'The transcript is hard to screenshot without a live session. Can we make the rendering surface fixture-driven?',
    }],
  },
  {
    id: 'assistant-boundary-answer',
    role: 'assistant',
    parts: [
      {
        type: 'reasoning',
        text: 'I need to preserve the streaming store boundary while extracting a stable presentation contract. The production adapter can keep per-message subscriptions and pass rendered rows into the view.',
        state: 'done',
      },
      {
        type: 'text',
        text: [
          'Yes. The useful boundary is a pure transcript surface, not a fake session stack.',
          '',
          '```tsx',
          '<ChatTranscriptView',
          '  messages={messageViews}',
          '  status="idle"',
          '  isReady',
          '/>',
          '```',
          '',
          'The runtime adapter still owns store subscriptions, approvals, scrolling metrics, and the minimap. The view owns layout, empty/error states, and message placement.',
        ].join('\n'),
      },
    ],
  },
  {
    id: 'user-contract-question',
    role: 'user',
    parts: [{
      type: 'text',
      text: 'What keeps Storybook from turning into a second application full of decorators?',
    }],
  },
  {
    id: 'assistant-contract-answer',
    role: 'assistant',
    parts: [{
      type: 'text',
      text: [
        'Three constraints:',
        '',
        '1. Stories import `*View` exports, never routes or containers.',
        '2. Fixtures contain serializable domain data; callbacks are local story actions.',
        '3. Query, router, Electron, and session providers stay out of the preview unless the primitive itself owns that narrow context.',
        '',
        'That makes a failing story evidence of a presentation regression rather than environment drift.',
      ].join('\n'),
    }],
  },
  {
    id: 'user-production-question',
    role: 'user',
    parts: [{
      type: 'text',
      text: 'Does production still use virtualization and per-message subscriptions?',
    }],
  },
  {
    id: 'assistant-production-answer',
    role: 'assistant',
    parts: [{
      type: 'text',
      text: 'Yes. `ChatMessageListPane` remains the runtime container. It adapts message IDs into view rows, and each `MessageBubbleById` retains its bounded subscription. Storybook supplies the same rows from `UIMessage` fixtures through the props-only `MessageBubble` export.',
    }],
  },
]

export const streamingChatTranscriptFixture: UIMessage[] = [
  ...chatTranscriptFixture,
  {
    id: 'user-streaming-question',
    role: 'user',
    parts: [{ type: 'text', text: 'Show the in-progress state too.' }],
  },
  {
    id: 'assistant-streaming-answer',
    role: 'assistant',
    parts: [{
      type: 'text',
      text: 'The final assistant row is streaming from fixture data, with no server or session lifecycle involved.',
    }],
  },
]
