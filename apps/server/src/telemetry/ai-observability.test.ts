import { describe, expect, it } from 'vitest'

import {
  applyAiGenerationResult,
  buildAiGenerationStartAttributes,
} from './ai-observability'

function createAttributeRecorder(): {
  attributes: Record<string, unknown>
  span: {
    setAttribute: (name: string, value: unknown) => unknown
    setStatus: () => unknown
  }
} {
  const attributes: Record<string, unknown> = {}
  return {
    attributes,
    span: {
      setAttribute(name: string, value: unknown) {
        attributes[name] = value
        return this
      },
      setStatus() {
        return this
      },
    },
  }
}

const result = {
  modelId: 'gpt-5',
  usage: {
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    cachedInputTokens: 60,
    cacheWriteInputTokens: 10,
    reasoningOutputTokens: 5,
  },
  estimatedCostUsd: 0.01,
  timeToFirstTokenMs: 250,
  outcome: 'success' as const,
  stopReason: 'stop',
  outputChoices: [{ role: 'assistant', content: 'answer' }],
  tools: ['Read', 'Bash'],
}

describe('postHog AI generation attributes', () => {
  it('records input messages only in full mode', () => {
    const input = {
      correlation: {
        sessionId: 'session-1',
        runId: 'run-1',
      },
      runtimeKind: 'codex',
      providerKind: 'openai',
      requestedModelId: 'gpt-5',
      internalContinuation: false,
      inputMessages: () => [{ role: 'user', content: 'prompt' }],
    }

    expect(buildAiGenerationStartAttributes(input, 'metadata')).not.toHaveProperty(
      'gen_ai.input.messages',
    )
    expect(
      JSON.parse(String(
        buildAiGenerationStartAttributes(input, 'full')['gen_ai.input.messages'],
      )),
    ).toEqual(input.inputMessages())
  })

  it('adds stable opaque session and run correlation without exporting raw ids', () => {
    const input = {
      correlation: {
        sessionId: 'session-1',
        runId: 'run-1',
      },
      runtimeKind: 'codex',
      providerKind: 'openai',
      requestedModelId: 'gpt-5',
      internalContinuation: false,
      inputMessages: () => [],
    }

    const attributes = buildAiGenerationStartAttributes(input, 'metadata')
    const repeatedAttributes = buildAiGenerationStartAttributes(input, 'metadata')

    expect(attributes).toMatchObject({
      'cradle.ai.schema_version': 2,
      'cradle.ai.correlation_version': 1,
    })
    expect(attributes.session_id).toBe(repeatedAttributes.session_id)
    expect(attributes.run_id).toBe(repeatedAttributes.run_id)
    expect(attributes.session_id).toMatch(/^[a-f0-9]{32}$/)
    expect(attributes.run_id).toMatch(/^[a-f0-9]{32}$/)
    expect(attributes.session_id).not.toContain(input.correlation.sessionId)
    expect(attributes.run_id).not.toContain(input.correlation.runId)
  })

  it('records cache and reasoning usage without content in metadata mode', () => {
    const { attributes, span } = createAttributeRecorder()
    applyAiGenerationResult(span, result, 'metadata')

    expect(attributes).toMatchObject({
      '$ai_cache_read_input_tokens': 60,
      '$ai_cache_creation_input_tokens': 10,
      'cradle.ai.reasoning_output_tokens': 5,
    })
    expect(attributes).not.toHaveProperty('gen_ai.output.messages')
    expect(attributes).not.toHaveProperty('$ai_tools')
  })

  it('records outputs and tools in full mode', () => {
    const { attributes, span } = createAttributeRecorder()
    applyAiGenerationResult(span, result, 'full')

    expect(JSON.parse(String(attributes['gen_ai.output.messages'])))
      .toEqual(result.outputChoices)
    expect(JSON.parse(String(attributes.$ai_tools))).toEqual(result.tools)
  })
})
