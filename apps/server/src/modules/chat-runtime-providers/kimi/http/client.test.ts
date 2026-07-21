import { ofetch } from 'ofetch'
import { describe, expect, it } from 'vitest'

import { getApiV1Healthz } from '../protocol/rest/sdk.gen'
import type { KimiRequestResult } from './client'
import {
  createKimiHttpClient,
  KimiHttpError,
  unwrapKimiResponse,
} from './client'

describe('kimi HTTP client', () => {
  it('injects host authentication and unwraps a generated SDK response', async () => {
    const requests: Request[] = []
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      return new Response(JSON.stringify({
        code: 0,
        data: { status: 'ok' },
        msg: 'OK',
        request_id: 'request-1',
      }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    const kimi = createKimiHttpClient({
      baseUrl: 'http://127.0.0.1:58627',
      bearerToken: 'temporary-token',
      ofetch: ofetch.create({}, { fetch }),
    })

    const data = await kimi.request(getApiV1Healthz({ client: kimi.client }))

    expect(data).toEqual({ status: 'ok' })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('http://127.0.0.1:58627/api/v1/healthz')
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer temporary-token')
    expect(kimi.client.getConfig()).toMatchObject({ retry: 0, timeout: 30_000 })
  })

  it('turns Kimi error envelopes into a stable error', async () => {
    const operation = Promise.resolve({
      data: {
        code: 4001,
        data: null,
        msg: 'Approval is required.',
        request_id: 'request-2',
      },
      error: undefined,
      response: new Response(null, { status: 409 }),
    } satisfies KimiRequestResult<{ code: number, data: null, msg: string, request_id: string }>)

    await expect(unwrapKimiResponse(operation)).rejects.toMatchObject({
      code: 4001,
      message: 'Approval is required.',
      name: KimiHttpError.name,
      requestId: 'request-2',
      status: 409,
    })
  })
})
