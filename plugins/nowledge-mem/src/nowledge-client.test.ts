import { describe, expect, it, vi } from 'vitest'

import type { NowledgeClientError } from './nowledge-client'
import { NowledgeClient } from './nowledge-client'

interface FetchCall {
  url: string
  init: RequestInit
}

function createJsonFetch(responseBody: unknown, status = 200): {
  calls: FetchCall[]
  fetch: typeof fetch
} {
  const calls: FetchCall[] = []
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    calls.push({
      url: String(input),
      init: init ?? {},
    })
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })

  return { calls, fetch: fetchMock }
}

describe('nowledge client', () => {
  it('uses q for memory search, forwards space_id, and sends API key as an auth header', async () => {
    const { calls, fetch } = createJsonFetch({ memories: [] })
    const client = new NowledgeClient({
      apiUrl: 'http://nmem.test/',
      apiKey: 'secret-token',
      spaceId: 'Research Agent',
      fetch,
    })

    await client.searchMemories({ q: 'cradle memory', limit: 3, mode: 'fast' })

    expect(calls).toHaveLength(1)
    const url = new URL(calls[0]!.url)
    expect(url.origin).toBe('http://nmem.test')
    expect(url.pathname).toBe('/memories/search')
    expect(url.searchParams.get('q')).toBe('cradle memory')
    expect(url.searchParams.has('query')).toBe(false)
    expect(url.searchParams.get('limit')).toBe('3')
    expect(url.searchParams.get('mode')).toBe('fast')
    expect(url.searchParams.get('space_id')).toBe('Research Agent')
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token')
  })

  it('uses query for thread search and does not send q', async () => {
    const { calls, fetch } = createJsonFetch({ threads: [] })
    const client = new NowledgeClient({
      apiUrl: 'http://nmem.test',
      fetch,
    })

    await client.searchThreads({ query: 'prior discussion', limit: 5, source: 'cradle' })

    expect(calls).toHaveLength(1)
    const url = new URL(calls[0]!.url)
    expect(url.pathname).toBe('/threads/search')
    expect(url.searchParams.get('query')).toBe('prior discussion')
    expect(url.searchParams.has('q')).toBe(false)
    expect(url.searchParams.get('limit')).toBe('5')
    expect(url.searchParams.get('source')).toBe('cradle')
  })

  it('injects space_id into JSON bodies without overwriting explicit body space', async () => {
    const { calls, fetch } = createJsonFetch({ ok: true })
    const client = new NowledgeClient({
      apiUrl: 'http://nmem.test',
      spaceId: 'Default Workspace',
      fetch,
    })

    await client.createMemory({ content: 'Remember this' })
    await client.createThread({
      thread_id: 'cradle:demo',
      messages: [{ role: 'user', content: 'Hello' }],
      space_id: 'Explicit Space',
    })

    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      content: 'Remember this',
      space_id: 'Default Workspace',
    })
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      thread_id: 'cradle:demo',
      messages: [{ role: 'user', content: 'Hello' }],
      space_id: 'Explicit Space',
    })
  })

  it('maps non-2xx upstream responses to NowledgeClientError', async () => {
    const { fetch } = createJsonFetch({ error: 'not authorized' }, 401)
    const client = new NowledgeClient({
      apiUrl: 'http://nmem.test',
      fetch,
    })

    await expect(client.readHealth()).rejects.toMatchObject({
      name: 'NowledgeClientError',
      code: 'nowledge_upstream_error',
      status: 401,
    } satisfies Partial<NowledgeClientError>)
  })
})
