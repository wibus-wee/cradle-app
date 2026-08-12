import { Agent, fetch as undiciFetch } from 'undici'

export interface M0ProxyDiagnostics {
  activeRequests: number
  responseCancels: number
  requestSignalAborts: number
  defaultSessionHits: number
  partitionHits: number
  customSchemeModuleHits: number
  rejectedAuthorities: number
}

export interface M0Proxy {
  agent: Agent
  diagnostics: M0ProxyDiagnostics
  handle: (request: Request) => Promise<Response>
}

function isModulePath(pathname: string): boolean {
  return pathname === '/simple.mjs'
    || pathname === '/api/plugins/system-info/web.mjs'
    || pathname.startsWith('/api/plugins/-/deps/')
}

export function createM0Proxy(upstreamOrigin: string): M0Proxy {
  const agent = new Agent({ connections: 2, pipelining: 1 })
  const diagnostics: M0ProxyDiagnostics = {
    activeRequests: 0,
    responseCancels: 0,
    requestSignalAborts: 0,
    defaultSessionHits: 0,
    partitionHits: 0,
    customSchemeModuleHits: 0,
    rejectedAuthorities: 0,
  }

  const handle = async (request: Request): Promise<Response> => {
    diagnostics.defaultSessionHits += 1
    const customUrl = new URL(request.url)
    if (
      customUrl.protocol !== 'cradle-server:'
      || customUrl.hostname !== 'local'
      || customUrl.port !== ''
      || customUrl.username !== ''
      || customUrl.password !== ''
    ) {
      diagnostics.rejectedAuthorities += 1
      return new Response('invalid cradle-server authority', { status: 400 })
    }
    if (isModulePath(customUrl.pathname)) { diagnostics.customSchemeModuleHits += 1 }

    diagnostics.activeRequests += 1
    let finalized = false
    const finalize = () => {
      if (finalized) { return }
      finalized = true
      diagnostics.activeRequests -= 1
    }

    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('content-length')
    headers.delete('connection')
    const upstreamUrl = new URL(`${customUrl.pathname}${customUrl.search}`, upstreamOrigin)
    const init: Parameters<typeof undiciFetch>[1] & { duplex?: 'half' } = {
      method: request.method,
      headers: [...headers.entries()],
      signal: request.signal,
      dispatcher: agent,
      redirect: 'manual',
    }
    if (request.body && request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body
      init.duplex = 'half'
    }

    request.signal.addEventListener('abort', () => {
      diagnostics.requestSignalAborts += 1
    }, { once: true })

    try {
      const upstreamResponse = await undiciFetch(upstreamUrl, init)
      const upstreamBody = upstreamResponse.body
      if (!upstreamBody) {
        finalize()
        return new Response(null, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: [...upstreamResponse.headers.entries()],
        })
      }

      const reader = upstreamBody.getReader()
      let upstreamCancelled: Promise<void> | undefined
      const cancelUpstream = (reason?: string): Promise<void> => {
        if (!upstreamCancelled) {
          upstreamCancelled = reader.cancel(reason).then(() => undefined, () => undefined)
        }
        return upstreamCancelled
      }
      request.signal.addEventListener('abort', () => {
        void cancelUpstream('renderer request aborted')
      }, { once: true })

      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read()
            if (next.done) {
              controller.close()
              finalize()
              return
            }
            controller.enqueue(next.value)
          }
          catch (error) {
            controller.error(error)
            finalize()
          }
        },
        async cancel(reason) {
          diagnostics.responseCancels += 1
          await cancelUpstream(String(reason ?? 'renderer response cancelled'))
          finalize()
        },
      })

      return new Response(body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: [...upstreamResponse.headers.entries()],
      })
    }
    catch (error) {
      finalize()
      throw error
    }
  }

  return { agent, diagnostics, handle }
}
