import { cradleFetch } from '../../../../../web/src/lib/server-credential'
import { applyDesktopServerReadyEndpoint } from '../../../../../web/src/lib/server-transport/base-url'

declare global {
  interface Window {
    serverFetchSmoke: {
      complete: (result: { finite: string, stream?: string }) => void
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

void run().catch(error => window.serverFetchSmoke.complete({
  finite: error instanceof Error ? error.message : String(error),
}))
