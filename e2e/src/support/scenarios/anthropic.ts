import type { JsonValue, SimulatorExchange, StreamStep } from '@cradle/model-api-simulator'

export const E2E_ANTHROPIC_MODEL = 'claude-sonnet-4-5'

function messageStart(messageId: string): StreamStep {
  return {
    kind: 'event',
    event: {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: E2E_ANTHROPIC_MODEL,
        content: [],
        container: null,
        context_management: null,
        diagnostics: null,
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: {
          cache_creation: null,
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          fallback_credit: null,
          inference_geo: null,
          iterations: null,
          output_tokens_details: null,
          server_tool_use: null,
          service_tier: null,
          speed: null,
        },
      },
    },
  }
}

function messageDelta(stopReason: 'end_turn' | 'tool_use'): JsonValue {
  return {
    type: 'message_delta',
    context_management: null,
    delta: {
      container: null,
      stop_details: null,
      stop_reason: stopReason,
      stop_sequence: null,
    },
    usage: {
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      fallback_credit: null,
      input_tokens: 1,
      iterations: null,
      output_tokens: 3,
      output_tokens_details: null,
      server_tool_use: null,
    },
  }
}

function streamExchange(label: string, steps: StreamStep[]): SimulatorExchange {
  return {
    label,
    request: {
      method: 'POST',
      path: '/v1/messages',
      bodyFields: { '/stream': true },
    },
    response: { kind: 'stream', steps },
  }
}

export function anthropicTextExchange(input: {
  label: string
  text: string
  gateAfterStart?: string
  /** Emit an SSE `ping` frame before the text block, as the real API does between blocks. */
  pingBeforeText?: boolean
  bodyTextIncludes?: string | readonly string[]
  bodyTextExcludes?: string | readonly string[]
}): SimulatorExchange {
  const messageId = `msg_${input.label.replaceAll(/[^a-z0-9]+/gi, '_')}`
  const steps: StreamStep[] = [messageStart(messageId)]
  if (input.gateAfterStart) {
    steps.push({ kind: 'gate', name: input.gateAfterStart })
  }
  if (input.pingBeforeText) {
    steps.push({ kind: 'event', event: { type: 'ping' } })
  }
  steps.push(
    {
      kind: 'event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      },
    },
    {
      kind: 'event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: input.text },
      },
    },
    { kind: 'event', event: { type: 'content_block_stop', index: 0 } },
    { kind: 'event', event: messageDelta('end_turn') },
    { kind: 'event', event: { type: 'message_stop' } },
    { kind: 'close' },
  )
  const exchange = streamExchange(input.label, steps)
  return withBodyTextMatch(exchange, input)
}

function withBodyTextMatch(
  exchange: SimulatorExchange,
  input: {
    bodyTextIncludes?: string | readonly string[]
    bodyTextExcludes?: string | readonly string[]
  },
): SimulatorExchange {
  if (input.bodyTextIncludes === undefined && input.bodyTextExcludes === undefined) {
    return exchange
  }
  return {
    ...exchange,
    request: {
      ...exchange.request,
      ...(input.bodyTextIncludes === undefined
        ? {}
        : { bodyTextIncludes: input.bodyTextIncludes }),
      ...(input.bodyTextExcludes === undefined
        ? {}
        : { bodyTextExcludes: input.bodyTextExcludes }),
    },
  }
}

interface AnthropicToolUseSpec {
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
  /** Split the tool input across several `input_json_delta` frames instead of one. */
  inputJsonChunks?: readonly string[]
}

function toolUseContentBlockStart(index: number, spec: AnthropicToolUseSpec): StreamStep {
  return {
    kind: 'event',
    event: {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'tool_use',
        id: spec.toolUseId,
        name: spec.toolName,
        input: {},
        caller: { type: 'direct' },
      },
    },
  }
}

function toolUseInputDeltas(index: number, spec: AnthropicToolUseSpec): StreamStep[] {
  const serialized = JSON.stringify(spec.toolInput)
  const chunks = spec.inputJsonChunks ?? [serialized]
  return chunks.map(chunk => ({
    kind: 'event' as const,
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: chunk },
    },
  }))
}

export function anthropicToolUseExchange(input: {
  label: string
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
  inputJsonChunks?: readonly string[]
  gateAfterStart?: string
  bodyTextIncludes?: string | readonly string[]
  bodyTextExcludes?: string | readonly string[]
}): SimulatorExchange {
  return anthropicParallelToolUsesExchange({
    label: input.label,
    tools: [{
      toolUseId: input.toolUseId,
      toolName: input.toolName,
      toolInput: input.toolInput,
      ...(input.inputJsonChunks === undefined ? {} : { inputJsonChunks: input.inputJsonChunks }),
    }],
    ...(input.gateAfterStart === undefined ? {} : { gateAfterStart: input.gateAfterStart }),
    ...(input.bodyTextIncludes === undefined ? {} : { bodyTextIncludes: input.bodyTextIncludes }),
    ...(input.bodyTextExcludes === undefined ? {} : { bodyTextExcludes: input.bodyTextExcludes }),
  })
}

/**
 * One assistant message carrying multiple concurrent `tool_use` blocks (indices 0..n),
 * the way real models emit parallel tool calls in a single streaming turn.
 */
export function anthropicParallelToolUsesExchange(input: {
  label: string
  tools: readonly AnthropicToolUseSpec[]
  gateAfterStart?: string
  bodyTextIncludes?: string | readonly string[]
  bodyTextExcludes?: string | readonly string[]
}): SimulatorExchange {
  if (input.tools.length === 0) {
    throw new Error(`anthropicParallelToolUsesExchange(${input.label}) requires at least one tool`)
  }
  const messageId = `msg_${input.label.replaceAll(/[^a-z0-9]+/gi, '_')}`
  const steps: StreamStep[] = [messageStart(messageId)]
  if (input.gateAfterStart) {
    steps.push({ kind: 'gate', name: input.gateAfterStart })
  }
  input.tools.forEach((spec, index) => {
    steps.push(toolUseContentBlockStart(index, spec))
    steps.push(...toolUseInputDeltas(index, spec))
    steps.push({ kind: 'event', event: { type: 'content_block_stop', index } })
  })
  steps.push(
    { kind: 'event', event: messageDelta('tool_use') },
    { kind: 'event', event: { type: 'message_stop' } },
    { kind: 'close' },
  )
  const exchange = streamExchange(input.label, steps)
  return withBodyTextMatch(exchange, input)
}

export function anthropicThinkingTextExchange(input: {
  label: string
  thinking: string
  text: string
  bodyTextIncludes?: string | readonly string[]
  bodyTextExcludes?: string | readonly string[]
}): SimulatorExchange {
  const messageId = `msg_${input.label.replaceAll(/[^a-z0-9]+/gi, '_')}`
  const exchange = streamExchange(input.label, [
    messageStart(messageId),
    {
      kind: 'event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'thinking',
          thinking: '',
          // Non-empty signature keeps Claude Agent / Anthropic clients happy.
          signature: `e2e_sig_${input.label}`,
        },
      },
    },
    {
      kind: 'event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'thinking_delta',
          thinking: input.thinking,
          // Required when thinking-token-count beta is enabled (Claude Agent).
          estimated_tokens: null,
        },
      },
    },
    {
      kind: 'event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: `e2e_sig_${input.label}` },
      },
    },
    { kind: 'event', event: { type: 'content_block_stop', index: 0 } },
    {
      kind: 'event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '', citations: null },
      },
    },
    {
      kind: 'event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: input.text },
      },
    },
    { kind: 'event', event: { type: 'content_block_stop', index: 1 } },
    { kind: 'event', event: messageDelta('end_turn') },
    { kind: 'event', event: { type: 'message_stop' } },
    { kind: 'close' },
  ])
  return withBodyTextMatch(exchange, input)
}

/**
 * `redacted_thinking` blocks carry opaque encrypted payloads with no readable text.
 * The stream must still complete and render the following text block.
 */
export function anthropicRedactedThinkingTextExchange(input: {
  label: string
  text: string
  bodyTextIncludes?: string | readonly string[]
  bodyTextExcludes?: string | readonly string[]
}): SimulatorExchange {
  const messageId = `msg_${input.label.replaceAll(/[^a-z0-9]+/gi, '_')}`
  const exchange = streamExchange(input.label, [
    messageStart(messageId),
    { kind: 'event', event: { type: 'ping' } },
    {
      kind: 'event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'redacted_thinking',
          data: 'e2e_redacted_thinking_payload',
        },
      },
    },
    { kind: 'event', event: { type: 'content_block_stop', index: 0 } },
    {
      kind: 'event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '', citations: null },
      },
    },
    {
      kind: 'event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: input.text },
      },
    },
    { kind: 'event', event: { type: 'content_block_stop', index: 1 } },
    { kind: 'event', event: messageDelta('end_turn') },
    { kind: 'event', event: { type: 'message_stop' } },
    { kind: 'close' },
  ])
  return withBodyTextMatch(exchange, input)
}

/**
 * Cut the SSE connection mid-text after the first visible delta — exercises the
 * provider transport failure path that HTTP-status errors cannot reach.
 */
export function anthropicDisconnectAfterStartExchange(input: {
  label: string
  partialText: string
  gateAfterStart?: string
  bodyTextIncludes?: string | readonly string[]
  bodyTextExcludes?: string | readonly string[]
}): SimulatorExchange {
  const messageId = `msg_${input.label.replaceAll(/[^a-z0-9]+/gi, '_')}`
  const steps: StreamStep[] = [messageStart(messageId)]
  if (input.gateAfterStart) {
    steps.push({ kind: 'gate', name: input.gateAfterStart })
  }
  steps.push(
    {
      kind: 'event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      },
    },
    {
      kind: 'event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: input.partialText },
      },
    },
    { kind: 'disconnect', reason: `${input.label}: simulated mid-stream disconnect` },
  )
  const exchange = streamExchange(input.label, steps)
  return withBodyTextMatch(exchange, input)
}

export function anthropicHttpErrorExchange(input: {
  label: string
  status?: number
  message: string
  /** Substrings that must appear in the request body (e.g. user prompt). */
  bodyTextIncludes?: string | readonly string[]
  bodyTextExcludes?: string | readonly string[]
}): SimulatorExchange {
  // Prefer HTTP error JSON (not SSE error events): Claude Agent's stream decoder
  // validates every SSE frame as AnthropicBetaRawMessageStreamEvent, which does
  // not include `type: error`, and remaps those into schema 400s that hide the
  // scripted failure message.
  return {
    label: input.label,
    request: {
      method: 'POST',
      path: '/v1/messages',
      bodyFields: { '/stream': true },
      ...(input.bodyTextIncludes === undefined
        ? {}
        : { bodyTextIncludes: input.bodyTextIncludes }),
      ...(input.bodyTextExcludes === undefined
        ? {}
        : { bodyTextExcludes: input.bodyTextExcludes }),
    },
    response: {
      kind: 'json',
      status: input.status ?? 503,
      // Tell Anthropic SDKs not to retry so the scripted message reaches the UI.
      headers: {
        'x-should-retry': 'false',
        'request-id': `req_${input.label}`,
      },
      body: {
        type: 'error',
        request_id: `req_${input.label}`,
        error: {
          type: 'api_error',
          message: input.message,
        },
      },
    },
  }
}

export function anthropicScenario(exchanges: SimulatorExchange[]) {
  return { provider: 'anthropic' as const, exchanges }
}

/** Plan-mode approval flow: ExitPlanMode tool_use then completion text after allow. */
export function anthropicApprovalExchanges(input: {
  planText?: string
  completionText?: string
}): SimulatorExchange[] {
  return [
    anthropicToolUseExchange({
      label: 'approval-plan',
      toolUseId: 'toolu_e2e_plan_approval',
      toolName: 'ExitPlanMode',
      toolInput: {
        plan: input.planText ?? '1. Run echo hello\n2. Report the command output',
      },
    }),
    // Completion text is enqueued just-in-time on Allow to avoid FIFO theft.
  ]
}
