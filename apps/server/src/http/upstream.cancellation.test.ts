import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { proxyUpstreamRequestByBaseUrl } from './upstream'

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })))
})

describe('upstream proxy cancellation', () => {
  it('closes the upstream socket when the inbound request signal aborts after headers', async () => {
    let resolveClosed!: () => void
    const upstreamClosed = new Promise<void>((resolve) => {
      resolveClosed = resolve
    })
    const server = createServer((_request, response) => {
      response.once('close', resolveClosed)
      response.writeHead(200, {
        'content-length': String(8 * 1024 * 1024),
        'content-type': 'application/octet-stream',
      })
      response.flushHeaders()
      response.write(Buffer.alloc(1024 * 1024, 3))
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    const controller = new AbortController()
    const request = new Request('http://controller.test/remote', {
      signal: controller.signal,
    })
    const response = await proxyUpstreamRequestByBaseUrl(
      `http://127.0.0.1:${address.port}`,
      request,
      '/large',
    )
    expect(response.status).toBe(200)

    controller.abort(new DOMException('downstream disconnected', 'AbortError'))

    await Promise.race([
      upstreamClosed,
      new Promise<never>((_resolve, reject) => setTimeout(
        () => reject(new Error('proxy upstream socket did not close after abort')),
        1_000,
      )),
    ])
  })
})
