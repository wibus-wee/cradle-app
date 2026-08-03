import type { JsonObject, JsonValue, SimulatorExchange, StreamStep } from '@cradle/model-api-simulator'

export const E2E_OPENAI_MODEL = 'e2e-model'

function completedResponse(id: string, model: string, text: string, reasoningText?: string): JsonObject {
  const messageId = `msg_${id}`
  const output: JsonValue[] = []
  if (reasoningText) {
    output.push({
      id: `rs_${id}`,
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: reasoningText }],
    })
  }
  output.push({
    id: messageId,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text, annotations: [], logprobs: [] }],
  })
  return {
    id: `resp_${id}`,
    object: 'response',
    created_at: 1,
    status: 'completed',
    background: false,
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    max_tool_calls: null,
    model,
    output,
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: reasoningText ? { effort: null, summary: 'auto' } : null,
    service_tier: 'default',
    store: false,
    temperature: 1,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: 1,
    truncation: 'disabled',
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: Math.max(1, Math.ceil(text.length / 4)),
      output_tokens_details: { reasoning_tokens: reasoningText ? Math.ceil(reasoningText.length / 4) : 0 },
      total_tokens: 10 + Math.max(1, Math.ceil(text.length / 4)),
    },
    metadata: {},
  }
}

function textStreamSteps(input: {
  id: string
  model: string
  text: string
  reasoningText?: string
  gateAfterCreated?: string
  chunkDelayYields?: number
}): StreamStep[] {
  const response = completedResponse(input.id, input.model, input.text, input.reasoningText)
  const messageId = `msg_${input.id}`
  const steps: StreamStep[] = [
    {
      kind: 'event',
      event: {
        type: 'response.created',
        sequence_number: 0,
        response: { ...response, status: 'in_progress', output: [] },
      },
    },
  ]
  if (input.gateAfterCreated) {
    steps.push({ kind: 'gate', name: input.gateAfterCreated })
  }

  let sequence = 1
  let outputIndex = 0

  if (input.reasoningText) {
    const reasoningId = `rs_${input.id}`
    steps.push({
      kind: 'event',
      event: {
        type: 'response.output_item.added',
        sequence_number: sequence++,
        output_index: outputIndex,
        item: { type: 'reasoning', id: reasoningId, summary: [] },
      },
    })
    steps.push({
      kind: 'event',
      event: {
        type: 'response.reasoning_summary_text.delta',
        sequence_number: sequence++,
        item_id: reasoningId,
        summary_index: 0,
        delta: input.reasoningText,
      },
    })
    steps.push({
      kind: 'event',
      event: {
        type: 'response.output_item.done',
        sequence_number: sequence++,
        output_index: outputIndex,
        item: {
          type: 'reasoning',
          id: reasoningId,
          summary: [{ type: 'summary_text', text: input.reasoningText }],
        },
      },
    })
    outputIndex += 1
  }

  steps.push({
    kind: 'event',
    event: {
      type: 'response.output_item.added',
      sequence_number: sequence++,
      output_index: outputIndex,
      item: {
        type: 'message',
        id: messageId,
        status: 'in_progress',
        role: 'assistant',
        content: [],
      },
    },
  })
  steps.push({
    kind: 'event',
    event: {
      type: 'response.content_part.added',
      sequence_number: sequence++,
      item_id: messageId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [], logprobs: [] },
    },
  })

  const words = input.text.split(/(\s+)/).filter(Boolean)
  for (const word of words) {
    if (input.chunkDelayYields && input.chunkDelayYields > 0) {
      for (let i = 0; i < input.chunkDelayYields; i++) {
        steps.push({ kind: 'yield' })
      }
    }
    steps.push({
      kind: 'event',
      event: {
        type: 'response.output_text.delta',
        sequence_number: sequence++,
        item_id: messageId,
        output_index: outputIndex,
        content_index: 0,
        delta: word,
        logprobs: [],
      },
    })
  }

  steps.push({
    kind: 'event',
    event: {
      type: 'response.output_text.done',
      sequence_number: sequence++,
      item_id: messageId,
      output_index: outputIndex,
      content_index: 0,
      text: input.text,
      logprobs: [],
    },
  })
  steps.push({
    kind: 'event',
    event: {
      type: 'response.content_part.done',
      sequence_number: sequence++,
      item_id: messageId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: 'output_text', text: input.text, annotations: [], logprobs: [] },
    },
  })
  steps.push({
    kind: 'event',
    event: {
      type: 'response.output_item.done',
      sequence_number: sequence++,
      output_index: outputIndex,
      item: {
        type: 'message',
        id: messageId,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: input.text, annotations: [], logprobs: [] }],
      },
    },
  })
  steps.push({
    kind: 'event',
    event: { type: 'response.completed', sequence_number: sequence++, response },
  })
  steps.push({ kind: 'close' })
  return steps
}

export function openAiTextExchange(input: {
  label: string
  text: string
  model?: string
  reasoningText?: string
  gateAfterCreated?: string
  chunkDelayYields?: number
  bodyTextIncludes?: string | readonly string[]
  bodyTextExcludes?: string | readonly string[]
}): SimulatorExchange {
  const id = input.label.replaceAll(/[^a-z0-9]+/gi, '_').toLowerCase()
  const model = input.model ?? E2E_OPENAI_MODEL
  return {
    label: input.label,
    request: {
      method: 'POST',
      path: '/v1/responses',
      bodyFields: { '/stream': true },
      ...(input.bodyTextIncludes === undefined
        ? {}
        : { bodyTextIncludes: input.bodyTextIncludes }),
      ...(input.bodyTextExcludes === undefined
        ? {}
        : { bodyTextExcludes: input.bodyTextExcludes }),
    },
    response: {
      kind: 'stream',
      steps: textStreamSteps({
        id,
        model,
        text: input.text,
        reasoningText: input.reasoningText,
        gateAfterCreated: input.gateAfterCreated,
        chunkDelayYields: input.chunkDelayYields,
      }),
    },
  }
}

export function openAiHttpErrorExchange(input: {
  label: string
  status?: number
  message: string
}): SimulatorExchange {
  return {
    label: input.label,
    request: {
      method: 'POST',
      path: '/v1/responses',
      bodyFields: { '/stream': true },
    },
    response: {
      kind: 'json',
      status: input.status ?? 503,
      body: {
        error: {
          message: input.message,
          type: 'server_error',
          code: 'e2e_forced_failure',
        },
      },
    },
  }
}

export function openAiScenario(exchanges: SimulatorExchange[]) {
  return { provider: 'openai' as const, exchanges }
}
