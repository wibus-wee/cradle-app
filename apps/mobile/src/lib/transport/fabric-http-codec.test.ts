import { describe, expect, it, vi } from 'vitest'

import {
  FabricHttpResponseDecoder,
  serializeFabricHttpRequest,
} from './fabric-http-codec'

const encoder = new TextEncoder()

function decoder(method = 'GET') {
  const consumed: Array<{ bytes: number, flush?: boolean }> = []
  const onCancel = vi.fn()
  const response = new FabricHttpResponseDecoder(method, {
    onCancel,
    onConsumed: (bytes, flush) => consumed.push({ bytes, flush }),
  })
  return { consumed, onCancel, response }
}

function totalConsumed(values: Array<{ bytes: number }>): number {
  return values.reduce((total, value) => total + value.bytes, 0)
}

describe('mobile Fabric HTTP codec', () => {
  it('serializes an authenticated API request without forwarding credentials', () => {
    const request = serializeFabricHttpRequest('/workspaces', {
      method: 'post',
      headers: {
        'authorization': 'Bearer must-not-cross-fabric',
        'content-type': 'application/json',
      },
      body: '{"name":"Cradle"}',
    })
    const text = new TextDecoder().decode(request.bytes)

    expect(request.method).toBe('POST')
    expect(text).toContain('POST /workspaces HTTP/1.1\r\n')
    expect(text).toContain('content-length: 17\r\n')
    expect(text).toContain('host: cradle.fabric\r\n')
    expect(text).not.toContain('must-not-cross-fabric')
    expect(text.endsWith('\r\n\r\n{"name":"Cradle"}')).toBe(true)
  })

  it('decodes a fragmented Content-Length response and ACKs body bytes on consumption', async () => {
    const exchange = decoder()
    const source = encoder.encode('HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 11\r\n\r\n{"ok":true}')
    exchange.response.push(source.subarray(0, 19))
    exchange.response.push(source.subarray(19, 72))
    const response = await exchange.response.response

    const consumedBeforeBodyRead = totalConsumed(exchange.consumed)
    expect(consumedBeforeBodyRead).toBe(source.byteLength - 11)

    exchange.response.push(source.subarray(72))
    expect(await response.json()).toEqual({ ok: true })
    expect(totalConsumed(exchange.consumed)).toBe(source.byteLength)
    expect(exchange.consumed.some(value => value.flush === true)).toBe(true)
  })

  it('streams fragmented chunked SSE and accounts for framing bytes', async () => {
    const exchange = decoder()
    const source = encoder.encode([
      'HTTP/1.1 200 OK\r\n',
      'content-type: text/event-stream\r\n',
      'transfer-encoding: chunked\r\n\r\n',
      '6\r\nhello\n\r\n',
      '6\r\nworld\n\r\n',
      '0\r\nx-finished: yes\r\n\r\n',
    ].join(''))
    for (let offset = 0; offset < source.byteLength; offset += 3) {
      exchange.response.push(source.subarray(offset, offset + 3))
    }

    const response = await exchange.response.response
    expect(totalConsumed(exchange.consumed)).toBeLessThan(source.byteLength)
    expect(await response.text()).toBe('hello\nworld\n')
    expect(totalConsumed(exchange.consumed)).toBe(source.byteLength)
    expect(exchange.onCancel).not.toHaveBeenCalled()
  })

  it('delivers streaming data that arrives after a consumer starts reading', async () => {
    const exchange = decoder()
    exchange.response.push(encoder.encode(
      'HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n',
    ))
    const response = await exchange.response.response
    const reader = response.body!.getReader()
    const pendingRead = reader.read()

    exchange.response.push(encoder.encode('5\r\nhello\r\n0\r\n\r\n'))

    await expect(pendingRead).resolves.toEqual({ done: false, value: encoder.encode('hello') })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
  })

  it('uses peer close to finish an unframed streaming response', async () => {
    const exchange = decoder()
    const source = encoder.encode('HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\n\r\nstreamed')
    exchange.response.push(source)
    const response = await exchange.response.response
    exchange.response.end()

    expect(await response.text()).toBe('streamed')
    expect(totalConsumed(exchange.consumed)).toBe(source.byteLength)
  })

  it('rejects malformed framing and cancels the Fabric stream', async () => {
    const exchange = decoder()
    exchange.response.push(encoder.encode('HTTP/1.1 200 OK\r\ncontent-length: nope\r\n\r\n'))

    await expect(exchange.response.response).rejects.toThrow('Content-Length')
    expect(exchange.onCancel).toHaveBeenCalledOnce()
  })

  it('closes the Fabric stream when the response consumer cancels', async () => {
    const exchange = decoder()
    exchange.response.push(encoder.encode(
      'HTTP/1.1 200 OK\r\ncontent-length: 12\r\n\r\nnot-consumed',
    ))
    const response = await exchange.response.response

    await response.body?.cancel()

    expect(exchange.onCancel).toHaveBeenCalledWith('response body cancelled')
  })
})
