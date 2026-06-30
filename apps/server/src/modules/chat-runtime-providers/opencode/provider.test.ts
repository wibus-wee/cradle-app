import { describe, expect, it } from 'vitest'

import type { AssistantMessage as OpencodeAssistantMessage } from '@opencode-ai/sdk'
import { formatOpencodeAssistantError } from './provider'

type OpencodeAssistantError = NonNullable<OpencodeAssistantMessage['error']>

describe('formatOpencodeAssistantError', () => {
  it('keeps upstream unsupported model details from opencode API errors', () => {
    const error: OpencodeAssistantError = {
      name: 'APIError',
      data: {
        message: 'Not Found: 当前 API 不支持所选模型 gpt-5.5',
        statusCode: 404,
        isRetryable: false,
        responseHeaders: {},
        responseBody: '{"error":"当前 API 不支持所选模型 gpt-5.5","type":"error"}',
      },
    }

    expect(formatOpencodeAssistantError(error)).toBe('404: Not Found: 当前 API 不支持所选模型 gpt-5.5')
  })

  it('keeps upstream credential failure details from opencode API errors', () => {
    const error: OpencodeAssistantError = {
      name: 'APIError',
      data: {
        message:
          'Unauthorized: {"error":{"code":"AuthenticationError","message":"the API key or AK/SK in the request is missing or invalid"}}',
        statusCode: 401,
        isRetryable: false,
        responseHeaders: {},
        responseBody:
          '{"error":{"code":"AuthenticationError","message":"the API key or AK/SK in the request is missing or invalid"}}',
      },
    }

    expect(formatOpencodeAssistantError(error)).toContain('401: Unauthorized')
    expect(formatOpencodeAssistantError(error)).toContain('the API key or AK/SK in the request is missing or invalid')
  })
})
