import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { FakeUpstream } from './fake-upstream'
import { startFakeUpstream } from './fake-upstream'
import type { M0Proxy } from './proxy-handler'
import { createM0Proxy } from './proxy-handler'

let temporaryRoot: string | undefined
let upstream: FakeUpstream | undefined
let proxy: M0Proxy | undefined

async function setup() {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'cradle-m0-proxy-'))
  upstream = await startFakeUpstream(temporaryRoot)
  proxy = createM0Proxy(upstream.origin)
  return { upstream, proxy }
}

function requestWithUrl(url: string): Request {
  const request = new Request('cradle-server://local/get')
  Object.defineProperty(request, 'url', { value: url })
  return request
}

afterEach(async () => {
  await proxy?.agent.close()
  await upstream?.close()
  if (temporaryRoot) { await rm(temporaryRoot, { recursive: true, force: true }) }
  temporaryRoot = undefined
  upstream = undefined
  proxy = undefined
})

describe('m0 fixture proxy', () => {
  it('preserves basic Fetch semantics and rejects non-exact authorities', async () => {
    const fixture = await setup()
    const response = await fixture.proxy.handle(new Request('cradle-server://local/get?value=m0'))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-m0-upstream')).toBe('get')
    await expect(response.json()).resolves.toEqual({ method: 'GET', value: 'm0' })

    const rejectedUrls = [
      'cradle-server://remote/get',
      'cradle-server://local:444/get',
      'cradle-server://user@local/get',
      'cradle-server://user:password@local/get',
      'cradle-server:///get',
      'cradle-server://local./get',
    ]
    for (const url of rejectedUrls) {
      const rejected = await fixture.proxy.handle(requestWithUrl(url))
      expect(rejected.status).toBe(400)
    }
    expect(fixture.proxy.diagnostics.rejectedAuthorities).toBe(rejectedUrls.length)
  })

  it('delivers the first response chunk before delayed completion', async () => {
    const fixture = await setup()
    const response = await fixture.proxy.handle(new Request('cradle-server://local/response-stream'))
    const reader = response.body!.getReader()
    const first = await reader.read()
    const firstAt = performance.now()
    expect(first.done).toBe(false)
    while (!(await reader.read()).done) {
      // Consume without retaining response bytes.
    }
    expect(performance.now() - firstAt).toBeGreaterThanOrEqual(750)
  })

  it('propagates request abort and one response cancellation to upstream', async () => {
    const fixture = await setup()
    const controller = new AbortController()
    const response = await fixture.proxy.handle(new Request('cradle-server://local/cancel-stream', {
      signal: controller.signal,
    }))
    const reader = response.body!.getReader()
    expect((await reader.read()).done).toBe(false)
    controller.abort('test abort')
    await reader.cancel('test response cancel')
    await new Promise(resolve => setTimeout(resolve, 50))

    expect(fixture.proxy.diagnostics.requestSignalAborts).toBe(1)
    expect(fixture.proxy.diagnostics.responseCancels).toBe(1)
    expect(fixture.proxy.diagnostics.activeRequests).toBe(0)
    expect(fixture.upstream.diagnostics.upstreamCloses).toBe(1)
  })
})
