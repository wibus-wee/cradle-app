import type { ZodType } from 'zod'
import { z } from 'zod'

const AgentToolHttpErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
})

export class AgentToolHttpRequestError extends Error {
  readonly code: string | null
  readonly details: Record<string, unknown> | null

  constructor(input: {
    code: string | null
    message: string
    details: Record<string, unknown> | null
  }) {
    super(input.message)
    this.code = input.code
    this.details = input.details
  }
}

function requireServerUrl(): string {
  const value = process.env.CRADLE_SERVER_URL?.trim()
  if (!value) {
    throw new Error('CRADLE_SERVER_URL is required for Cradle Agent tools')
  }
  return value
}

export async function requestAgentToolJson<T>(input: {
  path: string
  body: Record<string, string>
  responseSchema: ZodType<T>
}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  const response = await fetch(new URL(input.path, requireServerUrl()), {
    method: 'POST',
    headers,
    body: JSON.stringify(input.body),
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : undefined
  if (response.ok) {
    return input.responseSchema.parse(json)
  }

  const parsed = AgentToolHttpErrorSchema.safeParse(json)
  throw new AgentToolHttpRequestError(parsed.success
    ? {
        code: parsed.data.code ?? null,
        message: parsed.data.message,
        details: parsed.data.details ?? null,
      }
    : {
        code: null,
        message: `${response.status} ${response.statusText}`,
        details: null,
      })
}
