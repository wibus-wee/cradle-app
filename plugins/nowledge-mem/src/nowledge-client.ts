export interface NowledgeClientOptions {
  apiUrl: string
  apiKey?: string
  spaceId?: string
  fetch?: typeof fetch
}

export interface SearchMemoriesInput {
  q: string
  limit?: number
  mode?: 'fast' | 'deep'
  spaceId?: string
}

export interface SearchThreadsInput {
  query: string
  limit?: number
  source?: string
  spaceId?: string
}

export interface ReadThreadInput {
  threadId: string
  limit?: number
  offset?: number
  spaceId?: string
}

export interface ReadContextBundleInput {
  agentId?: string
  hostAgentId?: string
  includeWorkingMemory?: boolean
  spaceId?: string
}

export interface AppendThreadInput {
  threadId: string
  messages: unknown[]
  idempotencyKey?: string
  spaceId?: string
}

export class NowledgeClientError extends Error {
  readonly status: number | null
  readonly code = 'nowledge_upstream_error'

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'NowledgeClientError'
    this.status = status
  }
}

export class NowledgeClient {
  private readonly apiUrl: string
  private readonly apiKey?: string
  private readonly spaceId?: string
  private readonly fetchImpl: typeof fetch

  constructor(options: NowledgeClientOptions) {
    this.apiUrl = normalizeApiUrl(options.apiUrl)
    this.apiKey = normalizeOptionalString(options.apiKey)
    this.spaceId = normalizeOptionalString(options.spaceId)
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  readHealth(): Promise<unknown> {
    return this.request('GET', '/health')
  }

  readWorkingMemory(input: { spaceId?: string } = {}): Promise<unknown> {
    return this.request('GET', '/agent/working-memory', {
      query: this.withSpace({}, input.spaceId),
    })
  }

  readContextBundle(input: ReadContextBundleInput = {}): Promise<unknown> {
    return this.request('GET', '/context/bundle', {
      query: this.withSpace({
        source_app: 'cradle',
        agent_id: input.agentId,
        host_agent_id: input.hostAgentId,
        include_working_memory: input.includeWorkingMemory !== false,
      }, input.spaceId),
    })
  }

  searchMemories(input: SearchMemoriesInput): Promise<unknown> {
    return this.request('GET', '/memories/search', {
      query: this.withSpace({
        q: input.q,
        limit: input.limit,
        mode: input.mode,
      }, input.spaceId),
    })
  }

  createMemory(input: unknown): Promise<unknown> {
    return this.request('POST', '/memories', {
      body: this.withSpaceBody(input),
    })
  }

  searchThreads(input: SearchThreadsInput): Promise<unknown> {
    return this.request('GET', '/threads/search', {
      query: this.withSpace({
        query: input.query,
        limit: input.limit,
        source: input.source,
      }, input.spaceId),
    })
  }

  readThread(input: ReadThreadInput): Promise<unknown> {
    return this.request('GET', `/threads/${encodeURIComponent(input.threadId)}`, {
      query: this.withSpace({
        limit: input.limit,
        offset: input.offset,
      }, input.spaceId),
    })
  }

  createThread(input: unknown): Promise<unknown> {
    return this.request('POST', '/threads', {
      body: this.withSpaceBody(input),
    })
  }

  appendThread(input: AppendThreadInput): Promise<unknown> {
    return this.request('POST', `/threads/${encodeURIComponent(input.threadId)}/append`, {
      body: this.withSpaceBody({
        messages: input.messages,
        deduplicate: true,
        ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
      }, input.spaceId),
    })
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: {
      query?: Record<string, unknown>
      body?: unknown
    } = {},
  ): Promise<unknown> {
    const url = new URL(path, `${this.apiUrl}/`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    let body: string | undefined
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(options.body)
    }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    const response = await this.fetchImpl(url.href, {
      method,
      headers,
      body,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const suffix = detail ? `: ${detail.slice(0, 200)}` : ''
      throw new NowledgeClientError(`HTTP ${response.status} from Nowledge Mem API${suffix}`, response.status)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      return response.json()
    }
    return response.text()
  }

  private withSpace(
    query: Record<string, unknown>,
    explicitSpaceId?: string,
  ): Record<string, unknown> {
    const spaceId = normalizeOptionalString(explicitSpaceId) ?? this.spaceId
    return spaceId ? { ...query, space_id: spaceId } : query
  }

  private withSpaceBody(body: unknown, explicitSpaceId?: string): unknown {
    const spaceId = normalizeOptionalString(explicitSpaceId) ?? this.spaceId
    if (!spaceId || !isRecord(body) || 'space_id' in body || 'spaceId' in body) {
      return body
    }
    return { ...body, space_id: spaceId }
  }
}

function normalizeApiUrl(value: string): string {
  const trimmed = value.trim()
  return (trimmed || 'http://127.0.0.1:14242').replace(/\/+$/, '')
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
