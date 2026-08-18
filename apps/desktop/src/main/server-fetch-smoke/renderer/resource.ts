import {
  createConversationAssistantReply,
  createConversationFollowUp,
  createInitialConversationHistory,
} from '../../../../../../packages/model-api-simulator/src/conversation-load-pattern'

import { cradleFetch } from '../../../../../web/src/lib/server-credential'
import { applyDesktopServerReadyEndpoint } from '../../../../../web/src/lib/server-transport/base-url'

interface ChatHandle {
  streamId: string
}

interface ChatEvent {
  streamId: string
  chunk?: unknown
  message?: string
}

export async function runResourceSmoke(): Promise<void> {
  const config = await window.serverFetchSmoke.resource.getConfig()
  const serverUrl = 'http://127.0.0.1'
  applyDesktopServerReadyEndpoint({
    serverUrl,
    connection: {
      kind: 'owned-ipc',
      serverUrl,
      rendererBaseUrl: serverUrl,
      generation: 1,
    },
  })

  window.serverFetchSmoke.resource.markPhase('dense-finite')
  await runFiniteRequests(config.finiteRequests, config.finiteConcurrency, 0)

  window.serverFetchSmoke.resource.markPhase('growing-history-chat')
  const chatCompletion = runGrowingConversation(config.conversationPattern)
  const genericStream = cradleFetch(new URL('/resource-stream', serverUrl), {
    headers: { Accept: 'text/event-stream' },
  }).then(async (response) => {
    if (!response.ok || !response.body) {
      throw new Error(`Generic resource stream failed with ${response.status}.`)
    }
    let bytes = 0
    const reader = response.body.getReader()
    while (true) {
      const value = await reader.read()
      if (value.done) {
        return bytes
      }
      bytes += value.value.byteLength
    }
  })

  let backgroundFiniteRequests = 0
  const backgroundFinite = (async () => {
    const until = Date.now() + config.durationMs
    while (Date.now() < until) {
      const count = Math.min(config.finiteConcurrency, 32)
      await runFiniteRequests(count, count, config.finiteRequests + backgroundFiniteRequests)
      backgroundFiniteRequests += count
      await delay(config.backgroundBurstIntervalMs)
    }
  })()

  const [genericStreamBytes] = await Promise.all([
    genericStream,
    chatCompletion,
    backgroundFinite,
  ])
  window.serverFetchSmoke.resource.markPhase('settling')
  await delay(config.settleMs)
  window.serverFetchSmoke.resource.complete({
    ...await chatCompletion,
    genericStreamBytes,
    backgroundFiniteRequests,
  })
}

async function runGrowingConversation(pattern: Awaited<ReturnType<
  typeof window.serverFetchSmoke.resource.getConfig
>>['conversationPattern']): Promise<{ chatChunksReceived: number, chatTurnsCompleted: number }> {
  const history = createInitialConversationHistory(pattern)
  const startedAt = Date.now()
  let chatChunksReceived = 0
  for (let turnIndex = 0; turnIndex < pattern.turnCount; turnIndex += 1) {
    const scheduledAt = startedAt + turnIndex * pattern.followUpIntervalMs
    await delay(Math.max(0, scheduledAt - Date.now()))
    history.push(createConversationFollowUp(pattern, turnIndex, history))
    chatChunksReceived += await runChatTurn(history)
    history.push(createConversationAssistantReply(pattern, turnIndex))
  }
  await delay(Math.max(0, startedAt + pattern.durationMs - Date.now()))
  return { chatChunksReceived, chatTurnsCompleted: pattern.turnCount }
}

async function runChatTurn(messages: readonly unknown[]): Promise<number> {
  let chunks = 0
  let expectedStreamId: string | null = null
  return await new Promise<number>((resolve, reject) => {
    const cleanup = (): void => {
      unsubscribeChunk()
      unsubscribeClosed()
      unsubscribeError()
    }
    const unsubscribeChunk = window.serverFetchSmoke.resource.onChatChunk((input: unknown) => {
      const event = input as ChatEvent
      if (!expectedStreamId || event.streamId === expectedStreamId) {
        chunks += 1
      }
    })
    const unsubscribeClosed = window.serverFetchSmoke.resource.onChatClosed((input: unknown) => {
      const event = input as ChatEvent
      if (expectedStreamId && event.streamId !== expectedStreamId) {
        return
      }
      cleanup()
      resolve(chunks)
    })
    const unsubscribeError = window.serverFetchSmoke.resource.onChatError((input: unknown) => {
      const event = input as ChatEvent
      if (expectedStreamId && event.streamId !== expectedStreamId) {
        return
      }
      cleanup()
      reject(new Error(event.message ?? 'Chat resource stream failed.'))
    })
    void window.serverFetchSmoke.resource.startChat({
      sessionId: 'resource-session',
      body: {
        text: 'Continue the growing long-context session.',
        messages,
      },
    }).then((handle: ChatHandle) => {
      expectedStreamId = handle.streamId
    }, (error: unknown) => {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

async function runFiniteRequests(total: number, concurrency: number, offset: number): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(total, concurrency) }, async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= total) {
        return
      }
      const expected = String(offset + index)
      const response = await cradleFetch(new URL(`/finite?request=${expected}`, 'http://127.0.0.1'))
      const body = await response.json() as { request: string }
      if (!response.ok || body.request !== expected) {
        throw new Error(`Finite request ${expected} returned an invalid response.`)
      }
    }
  })
  await Promise.all(workers)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
