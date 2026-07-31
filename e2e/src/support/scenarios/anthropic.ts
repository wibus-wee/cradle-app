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
        delta: { type: 'text_delta', text: input.text },
      },
    },
    { kind: 'event', event: { type: 'content_block_stop', index: 0 } },
    { kind: 'event', event: messageDelta('end_turn') },
    { kind: 'event', event: { type: 'message_stop' } },
    { kind: 'close' },
  )
  return streamExchange(input.label, steps)
}

export function anthropicToolUseExchange(input: {
  label: string
  toolUseId: string
  toolName: string
  toolInput: Record<string, unknown>
}): SimulatorExchange {
  const messageId = `msg_${input.label.replaceAll(/[^a-z0-9]+/gi, '_')}`
  return streamExchange(input.label, [
    messageStart(messageId),
    {
      kind: 'event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: input.toolUseId,
          name: input.toolName,
          input: {},
          caller: { type: 'direct' },
        },
      },
    },
    {
      kind: 'event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input.toolInput) },
      },
    },
    { kind: 'event', event: { type: 'content_block_stop', index: 0 } },
    { kind: 'event', event: messageDelta('tool_use') },
    { kind: 'event', event: { type: 'message_stop' } },
    { kind: 'close' },
  ])
}

export function anthropicThinkingTextExchange(input: {
  label: string
  thinking: string
  text: string
}): SimulatorExchange {
  const messageId = `msg_${input.label.replaceAll(/[^a-z0-9]+/gi, '_')}`
  return streamExchange(input.label, [
    messageStart(messageId),
    {
      kind: 'event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
    },
    {
      kind: 'event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: input.thinking },
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
}

export function anthropicHttpErrorExchange(input: {
  label: string
  status?: number
  message: string
}): SimulatorExchange {
  return {
    label: input.label,
    request: {
      method: 'POST',
      path: '/v1/messages',
      bodyFields: { '/stream': true },
    },
    response: {
      kind: 'json',
      status: input.status ?? 503,
      body: {
        type: 'error',
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
