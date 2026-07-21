import type { ofetch } from 'ofetch'
import { z } from 'zod'

import type { Client } from '../protocol/rest/client'
import { createClient } from '../protocol/rest/client'

const DEFAULT_TIMEOUT_MS = 30_000

const KimiEnvelopeSchema = z.object({
  code: z.number(),
  data: z.unknown(),
  msg: z.string(),
  request_id: z.string(),
})

export interface KimiHttpClientOptions {
  baseUrl: string
  bearerToken: string
  ofetch?: typeof ofetch
  timeoutMs?: number
}

export interface KimiApiEnvelope<T> {
  code: number
  data: T
  msg: string
  request_id: string
}

export interface KimiWireEnvelope<T> {
  code?: number
  data?: T
  msg?: string
  request_id?: string
}

export interface KimiRequestResult<T> {
  data: T | undefined
  error: unknown
  response?: Response
}

export interface KimiHttpClient {
  client: Client
  request: <T>(operation: Promise<KimiRequestResult<T>>) => Promise<KimiSuccessData<T>>
}

export type KimiSuccessData<T> = Extract<T, { code: 0, data: unknown }> extends { data: infer Data }
  ? Data
  : never

export class KimiHttpError extends Error {
  readonly code: number | null
  readonly requestId: string | null
  readonly status: number | null

  constructor(input: { code?: number, message: string, requestId?: string, status?: number }) {
    super(input.message)
    this.name = 'KimiHttpError'
    this.code = input.code ?? null
    this.requestId = input.requestId ?? null
    this.status = input.status ?? null
  }
}

export function createKimiHttpClient(input: KimiHttpClientOptions): KimiHttpClient {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Kimi HTTP timeout must be a positive finite number.')
  }

  const client = createClient({
    baseUrl: input.baseUrl,
    headers: { authorization: `Bearer ${input.bearerToken}` },
    ignoreResponseError: true,
    ofetch: input.ofetch,
    retry: 0,
    throwOnError: false,
    timeout: timeoutMs,
  })

  return {
    client,
    request: unwrapKimiResponse,
  }
}

export async function unwrapKimiResponse<T>(operation: Promise<KimiRequestResult<T>>): Promise<KimiSuccessData<T>> {
  const result = await operation
  const envelope = KimiEnvelopeSchema.safeParse(result.data ?? result.error)

  if (!envelope.success) {
    throw new KimiHttpError({
      message: `Kimi request failed with HTTP ${result.response?.status ?? 'unknown'}.`,
      status: result.response?.status,
    })
  }
  if (envelope.data.code !== 0) {
    throw new KimiHttpError({
      code: envelope.data.code,
      message: envelope.data.msg,
      requestId: envelope.data.request_id,
      status: result.response?.status,
    })
  }

  return envelope.data.data as KimiSuccessData<T>
}
