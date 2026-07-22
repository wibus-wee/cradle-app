import '@anthropic-ai/claude-agent-sdk'

declare module '@anthropic-ai/claude-agent-sdk' {
  interface Query {
    /** Claude Code `cancel_async_message` control request; omitted from SDK 0.3.207 declarations. */
    cancelAsyncMessage: (messageUuid: string) => Promise<boolean>
  }
}
