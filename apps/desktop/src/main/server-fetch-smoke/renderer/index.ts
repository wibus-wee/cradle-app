import { cradleFetch } from '../../../../../web/src/lib/server-credential'
import { applyDesktopServerReadyEndpoint } from '../../../../../web/src/lib/server-transport/base-url'

declare global {
  interface Window {
    serverFetchSmoke: {
      complete: (result: { finite: string, stream?: string }) => void
      resource: {
        getConfig: () => Promise<{
          durationMs: number
          contextTokens: number
          finiteRequests: number
          finiteConcurrency: number
          streamIntervalMs: number
          backgroundBurstIntervalMs: number
          settleMs: number
          conversationPattern: import('@cradle/model-api-simulator/conversation-load-pattern').GrowingConversationLoadPattern
        }>
        markPhase: (phase: string) => void
        startChat: (request: unknown) => Promise<{ streamId: string }>
        complete: (result: unknown) => void
        onChatChunk: (handler: (event: unknown) => void) => () => void
        onChatClosed: (handler: (event: unknown) => void) => () => void
        onChatError: (handler: (event: unknown) => void) => () => void
      }
    }
  }
}

async function run(): Promise<void> {
  const index = Number(new URLSearchParams(window.location.search).get('index'))
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

  const response = await cradleFetch(new URL(`/finite?window=${index}`, serverUrl))
  const payload = await response.json() as { window: number }
  const result: { finite: string, stream?: string } = {
    finite: response.ok && payload.window === index ? 'ok' : 'invalid',
  }
  if (index === 0) {
    const stream = await cradleFetch(new URL('/stream', serverUrl), {
      headers: { Accept: 'text/event-stream' },
    })
    result.stream = await stream.text()
  }
  window.serverFetchSmoke.complete(result)
}

if (new URLSearchParams(window.location.search).get('profile') === 'resource') {
  void import('./resource').then(module => module.runResourceSmoke()).catch(error =>
    window.serverFetchSmoke.resource.complete({
      error: error instanceof Error ? error.message : String(error),
    }))
}
else {
  void run().catch(error => window.serverFetchSmoke.complete({
    finite: error instanceof Error ? error.message : String(error),
  }))
}
