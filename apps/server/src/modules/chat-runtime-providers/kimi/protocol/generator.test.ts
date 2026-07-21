import { describe, expect, it } from 'vitest'

import {
  createKimiProtocolManifest,
  normalizeKimiAsyncApiDocument,
  normalizeKimiOpenApiDocument,
  readKimiWebSocketMessages,
  renderKimiWebSocketCatalogue,
} from './generator'

describe('kimi protocol generator', () => {
  const openapi = {
    openapi: '3.0.3',
    servers: [{ url: 'http://127.0.0.1:65388/api/v1' }],
    paths: {},
  }

  const asyncapi = {
    asyncapi: '3.1.0',
    servers: {
      local: { host: '127.0.0.1:65388', protocol: 'ws' },
    },
    operations: {
      receiveClientMessages: {
        action: 'receive' as const,
        messages: [{ $ref: '#/components/messages/ClientHello' }],
      },
      sendServerMessages: {
        action: 'send' as const,
        messages: [{ $ref: '#/components/messages/ServerHello' }],
      },
    },
    components: {
      messages: {
        ServerHello: {
          name: 'server_hello',
          title: 'Server hello',
          payload: { type: 'object', properties: { type: { const: 'server_hello' } } },
        },
        ClientHello: {
          name: 'client_hello',
          summary: 'Start the connection.',
          payload: { type: 'object', properties: { type: { const: 'client_hello' } } },
        },
      },
    },
  }

  it('normalizes loopback ports before building the manifest', () => {
    const normalizedOpenapi = normalizeKimiOpenApiDocument(openapi)
    const normalizedAsyncapi = normalizeKimiAsyncApiDocument(asyncapi)
    const manifest = createKimiProtocolManifest({
      runtimeVersion: '0.28.0',
      openapi: normalizedOpenapi,
      asyncapi: normalizedAsyncapi,
      generatedDate: '2026-07-20',
    })

    expect(normalizedOpenapi.servers?.[0]?.url).toBe('http://127.0.0.1:{port}/api/v1')
    expect(normalizedAsyncapi.servers?.local?.host).toBe('127.0.0.1:{port}')
    expect(manifest).toMatchObject({
      runtimeVersion: '0.28.0',
      openapiSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      asyncapiSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('derives a stable, directional WebSocket catalogue from AsyncAPI operations', () => {
    expect(readKimiWebSocketMessages(asyncapi)).toMatchObject([
      { name: 'client_hello', direction: 'client_to_server' },
      { name: 'server_hello', direction: 'server_to_client' },
    ])

    const source = renderKimiWebSocketCatalogue(asyncapi)
    expect(source).toContain('export type KimiWebSocketMessageName = (typeof KIMI_WEB_SOCKET_MESSAGES)[number][\'name\']')
    expect(source).toContain('client_to_server')
    expect(source).toContain('server_to_client')
  })
})
