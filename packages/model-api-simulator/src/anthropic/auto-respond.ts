import type { JsonObject, JsonValue, ObservedRequest, StreamStep } from '../contract'
import { isJsonArray, isJsonObject } from '../contract'
import type { ScenarioController } from '../core/scenario-runtime'
import { createScheduledStream } from '../core/stream-scheduler'
import { encodeAnthropicEvent } from './sse'

const FALLBACK_MODEL = 'claude-sonnet-4-5'

/**
 * Synthesises a protocol-valid Anthropic response for requests that no enqueued
 * exchange claims. This turns the scenario replayer into a standalone stub API
 * that real clients (Claude Code, the SDK) can talk to indefinitely.
 */
export function autoAnthropicResponse(
  controller: ScenarioController,
  observed: Omit<ObservedRequest, 'index'>,
): Response {
  const body = observed.body !== undefined && isJsonObject(observed.body) ? observed.body : {}
  if (observed.path === '/v1/messages/count_tokens') {
    return Response.json(
      { input_tokens: estimateInputTokens(body) },
      { headers: { 'request-id': 'req_simulator_auto' } },
    )
  }
  if (observed.method.toUpperCase() === 'GET') {
    return modelsResponse(observed.path, body)
  }

  const model = typeof body.model === 'string' ? body.model : FALLBACK_MODEL
  const text = replyText(body)
  const inputTokens = estimateInputTokens(body)
  const outputTokens = Math.max(1, Math.ceil(text.length / 4))
  const messageId = `msg_simulator_${controller.requests().length}`

  if (body.stream !== true) {
    return Response.json(
      {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: usage(inputTokens, outputTokens),
      },
      { headers: { 'request-id': 'req_simulator_auto' } },
    )
  }

  const steps = streamSteps(messageId, model, text, inputTokens, outputTokens)
  return new Response(
    createScheduledStream(controller, steps, step => encodeAnthropicEvent(step.event)),
    {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'request-id': 'req_simulator_auto',
      },
    },
  )
}

function streamSteps(
  messageId: string,
  model: string,
  text: string,
  inputTokens: number,
  outputTokens: number,
): readonly StreamStep[] {
  const events: JsonValue[] = [
    {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: usage(inputTokens, 1),
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...chunk(text).map(part => ({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: part },
    })),
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokens },
    },
    { type: 'message_stop' },
  ]
  return events.map(event => ({ kind: 'event' as const, event }))
}

function modelsResponse(path: string, _body: JsonObject): Response {
  const model = {
    id: FALLBACK_MODEL,
    type: 'model',
    display_name: 'Simulator Model',
    created_at: '2025-01-01T00:00:00Z',
  }
  if (path === '/v1/models') {
    return Response.json(
      { data: [model], has_more: false, first_id: model.id, last_id: model.id },
      { headers: { 'request-id': 'req_simulator_auto' } },
    )
  }
  const id = path.slice('/v1/models/'.length)
  return Response.json(
    { ...model, id: decodeURIComponent(id) || model.id },
    { headers: { 'request-id': 'req_simulator_auto' } },
  )
}

function replyText(body: JsonObject): string {
  const prompt = lastUserText(body)
  return prompt
    ? `[simulator] 收到：${prompt}`
    : '[simulator] 自动回复。'
}

function lastUserText(body: JsonObject): string | undefined {
  const messages = body.messages
  if (messages === undefined || !isJsonArray(messages)) { return undefined }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isJsonObject(message) || message.role !== 'user') { continue }
    const text = flattenContent(message.content)
    if (text) { return text }
  }
  return undefined
}

function flattenContent(content: JsonValue | undefined): string {
  if (typeof content === 'string') { return content }
  if (content === undefined || !isJsonArray(content)) { return '' }
  return content
    .map(block =>
      isJsonObject(block) && block.type === 'text' && typeof block.text === 'string'
        ? block.text
        : '')
    .filter(Boolean)
    .join('\n')
}

function estimateInputTokens(body: JsonObject): number {
  return Math.max(1, Math.ceil(JSON.stringify(body).length / 4))
}

function usage(inputTokens: number, outputTokens: number): JsonObject {
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

function chunk(text: string, size = 12): readonly string[] {
  const parts: string[] = []
  for (let index = 0; index < text.length; index += size) {
    parts.push(text.slice(index, index + size))
  }
  return parts.length > 0 ? parts : ['']
}
