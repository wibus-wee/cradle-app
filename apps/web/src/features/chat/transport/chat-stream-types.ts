import type { UIMessageChunk } from 'ai'

export interface ChatStreamChunk {
  chunk: UIMessageChunk
  replay: boolean
}

export function liveChatStreamChunk(chunk: UIMessageChunk): ChatStreamChunk {
  return { chunk, replay: false }
}

export function replayChatStreamChunk(chunk: UIMessageChunk): ChatStreamChunk {
  return { chunk, replay: true }
}
