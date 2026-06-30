import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { Socket } from 'node:net'

import { z } from 'zod'

const ChatCompletionsRequestJsonSchema = z.string().transform(raw => JSON.parse(raw)).pipe(z.object({
  messages: z.array(z.object({
    role: z.string(),
    tool_call_id: z.string().optional(),
  })).default([]),
}))

const ResponsesRequestJsonSchema = z.string().transform(raw => JSON.parse(raw)).pipe(z.object({
  input: z.array(z.object({
    type: z.string().optional(),
  })).default([]),
}))

const AnthropicMessagesRequestJsonSchema = z.string().transform(raw => JSON.parse(raw)).pipe(z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.array(z.object({
      type: z.string().optional(),
    })).default([]),
  })).default([]),
  stream: z.boolean().optional(),
}))

export interface MockLlmRequestLogEntry {
  method: string
  path: string
  body: string
  recordedAt: number
}

export type MockLlmFailureMode = 'none' | 'http-error'

export interface MockToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface MockToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/**
 * Predefined Claude Agent SDK message scenarios for subagent/team testing.
 */
export type MockClaudeAgentScenario
  = | 'basic-chat'
    | 'tool-call'
    | 'agent-subagent' // Parent spawns Agent tool → subagent does work with parent_tool_use_id
    | 'agent-subagent-deep' // Subagent spawns its own Agent (nested depth 2)
    | 'agent-parallel' // Parent spawns 2 Agents at once
    | 'approval-tool' // Streams a Bash tool_use to trigger canUseTool/approval

export interface MockLlmServerOptions {
  /** Fixed response text the "assistant" will stream back. Default: 'Hello from mock LLM!' */
  responseText?: string
  /** Per-request response texts used in order for deterministic multi-turn scenarios. */
  responseTexts?: string[]
  /** Simulated delay (ms) between SSE chunks. Default: 10 */
  chunkDelay?: number
  /** Deterministic failure mode for request/stream error scenarios. */
  failureMode?: MockLlmFailureMode
  /** HTTP status code returned when failureMode is enabled. */
  errorStatusCode?: number
  /** Error payload text returned when failureMode is enabled. */
  errorMessage?: string
  /** Tool calls the model should emit instead of text. When set, responseText is sent after tool results. */
  toolCalls?: MockToolCall[]
  /** Tool definitions reported by the model (for validation). */
  tools?: MockToolDefinition[]
  /** Available models to report via /models endpoint. */
  models?: Array<{ id: string, owned_by?: string }>
  /** Reasoning/thinking text to emit before the main response. */
  reasoningText?: string
  /**
   * Predefined Claude Agent SDK message scenario.
   * When set, the /claude-agent/query endpoint streams a pre-crafted sequence
   * of SDKMessage JSON objects (including parent_tool_use_id for subagent events).
   */
  claudeAgentScenario?: MockClaudeAgentScenario
}

export class MockLlmServer {
  private server: Server | null = null
  private sockets = new Set<Socket>()
  private port = 0
  private responseText: string
  private readonly responseTexts: string[] | null
  private chunkDelay: number
  private readonly failureMode: MockLlmFailureMode
  private readonly errorStatusCode: number
  private readonly errorMessage: string
  private readonly toolCalls: MockToolCall[]
  private readonly _tools: MockToolDefinition[]
  private readonly models: Array<{ id: string, owned_by?: string }>
  private readonly reasoningText: string | null
  private readonly claudeAgentScenario: MockClaudeAgentScenario | null
  private requestLog: MockLlmRequestLogEntry[] = []
  private turnCount = 0

  constructor(opts: MockLlmServerOptions = {}) {
    this.responseText = opts.responseText ?? 'Hello from mock LLM!'
    this.responseTexts = opts.responseTexts?.length ? [...opts.responseTexts] : null
    this.chunkDelay = opts.chunkDelay ?? 10
    this.failureMode = opts.failureMode ?? 'none'
    this.errorStatusCode = opts.errorStatusCode ?? 500
    this.errorMessage = opts.errorMessage ?? 'Mock LLM forced failure'
    this.toolCalls = opts.toolCalls ?? []
    this._tools = opts.tools ?? []
    this.models = opts.models ?? [{ id: 'mock-model', owned_by: 'mock' }]
    this.reasoningText = opts.reasoningText ?? null
    this.claudeAgentScenario = opts.claudeAgentScenario ?? null
  }

  /** Start the server and return the base URL (e.g. http://localhost:PORT/v1) */
  async start(): Promise<string> {
    if (this.server) {
      throw new Error('MockLlmServer is already running')
    }
    this.requestLog = []
    this.turnCount = 0

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res))
      this.server.on('connection', (socket) => {
        this.sockets.add(socket)
        socket.on('close', () => {
          this.sockets.delete(socket)
        })
      })
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address()
        if (typeof addr === 'object' && addr) {
          this.port = addr.port
          resolve(`http://127.0.0.1:${this.port}/v1`)
        }
        else {
          reject(new Error('Failed to get server address'))
        }
      })
      this.server.on('error', reject)
    })
  }

  /** Stop the server */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve()
        return
      }

      const activeServer = this.server
      this.server = null
      this.port = 0

      let settled = false
      let timeout: NodeJS.Timeout | null = null
      const finish = () => {
        if (settled) {
          return
        }
        settled = true
        if (timeout) {
          clearTimeout(timeout)
        }
        resolve()
      }

      timeout = setTimeout(() => {
        activeServer.closeAllConnections?.()
        for (const socket of this.sockets) {
          socket.destroy()
        }
        this.sockets.clear()
        finish()
      }, 1000)

      try {
        activeServer.close(finish)
      }
      catch {
        finish()
      }
    })
  }

  getRequestLog(): MockLlmRequestLogEntry[] {
    return this.requestLog.map(entry => ({ ...entry }))
  }

  getTurnCount(): number {
    return this.turnCount
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? ''

    // CORS for browser clients
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      })
      res.end()
      return
    }

    if (req.method === 'GET' && url.endsWith('/models')) {
      this.recordRequest(req, '')
      this.handleModels(res)
      return
    }

    if (req.method === 'POST' && url.endsWith('/chat/completions')) {
      this.handleChatCompletions(req, res)
      return
    }

    if (req.method === 'POST' && url.endsWith('/responses')) {
      this.handleResponses(req, res)
      return
    }

    if (req.method === 'POST' && url.endsWith('/v1/messages')) {
      this.handleAnthropicMessages(req, res)
      return
    }

    if (req.method === 'POST' && url.endsWith('/claude-agent/query')) {
      this.handleClaudeAgentQuery(req, res)
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  }

  private handleModels(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      object: 'list',
      data: this.models.map(m => ({
        id: m.id,
        object: 'model',
        created: 0,
        owned_by: m.owned_by ?? 'mock',
      })),
    }))
  }

  private handleChatCompletions(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      this.recordRequest(req, body)
      this.turnCount++
      const responseText = this.getResponseTextForTurn(this.turnCount)

      if (this.failureMode === 'http-error') {
        res.writeHead(this.errorStatusCode, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          error: {
            message: this.errorMessage,
          },
        }))
        return
      }

      const parsedBody = ChatCompletionsRequestJsonSchema.parse(body)
      const hasToolResults = parsedBody.messages.some(m => m.role === 'tool')

      // First turn with tool calls configured and no tool results yet: emit tool calls
      if (this.toolCalls.length > 0 && !hasToolResults) {
        void this.streamToolCallResponse(res)
      }
      else {
        void this.streamResponse(res, responseText)
      }
    })
  }

  private recordRequest(req: IncomingMessage, body: string): void {
    this.requestLog.push({
      method: req.method ?? 'GET',
      path: req.url ?? '/',
      body,
      recordedAt: Date.now(),
    })
  }

  private getResponseTextForTurn(turnIndex: number): string {
    if (!this.responseTexts?.length) {
      return this.responseText
    }

    return this.responseTexts[Math.min(turnIndex - 1, this.responseTexts.length - 1)]!
  }

  private async streamResponse(res: ServerResponse, responseText: string): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const id = `chatcmpl-mock-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)
    const model = 'mock-model'

    // Stream reasoning if configured
    if (this.reasoningText) {
      const reasoningChunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: { role: 'assistant', reasoning_content: this.reasoningText },
          finish_reason: null,
        }],
        usage: null,
      }
      res.write(`data: ${JSON.stringify(reasoningChunk)}\n\n`)
      await this.delay(this.chunkDelay)
    }

    const words = responseText.split(' ')

    // Stream content word by word
    for (let i = 0; i < words.length; i++) {
      const content = i === 0 ? words[i] : ` ${words[i]}`
      const chunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: i === 0 && !this.reasoningText
            ? { role: 'assistant', content }
            : { content },
          finish_reason: null,
        }],
        usage: null,
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      await this.delay(this.chunkDelay)
    }

    // Final chunk with finish_reason + usage
    const finalChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: words.length,
        total_tokens: 10 + words.length,
      },
    }
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  }

  private async streamToolCallResponse(res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const id = `chatcmpl-mock-${Date.now()}`
    const created = Math.floor(Date.now() / 1000)
    const model = 'mock-model'

    // First chunk with role
    const roleChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: null, tool_calls: [] as unknown[] },
        finish_reason: null,
      }],
      usage: null,
    }
    res.write(`data: ${JSON.stringify(roleChunk)}\n\n`)
    await this.delay(this.chunkDelay)

    // Stream each tool call
    for (let i = 0; i < this.toolCalls.length; i++) {
      const tc = this.toolCalls[i]!
      // Tool call start
      const startChunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: i,
              id: tc.id,
              type: 'function',
              function: { name: tc.function.name, arguments: '' },
            }],
          },
          finish_reason: null,
        }],
        usage: null,
      }
      res.write(`data: ${JSON.stringify(startChunk)}\n\n`)
      await this.delay(this.chunkDelay)

      // Tool call arguments
      const argsChunk = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: i,
              function: { arguments: tc.function.arguments },
            }],
          },
          finish_reason: null,
        }],
        usage: null,
      }
      res.write(`data: ${JSON.stringify(argsChunk)}\n\n`)
      await this.delay(this.chunkDelay)
    }

    // Final chunk
    const finalChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'tool_calls',
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    }
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
    res.write('data: [DONE]\n\n')
    res.end()
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // ── Responses API (POST /v1/responses) ────────────────────────────────────

  private handleResponses(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      this.recordRequest(req, body)
      this.turnCount++
      const responseText = this.getResponseTextForTurn(this.turnCount)

      if (this.failureMode === 'http-error') {
        res.writeHead(this.errorStatusCode, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: this.errorMessage } }))
        return
      }

      const parsedBody = ResponsesRequestJsonSchema.parse(body)
      const hasToolResults = parsedBody.input.some(i => i.type === 'function_call_output')

      if (this.toolCalls.length > 0 && !hasToolResults) {
        void this.streamResponsesToolCall(res)
      }
      else {
        void this.streamResponsesText(res, responseText)
      }
    })
  }

  private async streamResponsesText(res: ServerResponse, responseText: string): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const responseId = `resp-mock-${Date.now()}`
    const model = 'mock-model'
    const created = Math.floor(Date.now() / 1000)

    // response.created
    this.writeSSE(res, { type: 'response.created', response: { id: responseId, created_at: created, model } })
    await this.delay(this.chunkDelay)

    // Reasoning (if configured)
    if (this.reasoningText) {
      const reasoningId = `rs-${Date.now()}`
      // output_item.added (reasoning)
      this.writeSSE(res, { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: reasoningId } })
      await this.delay(this.chunkDelay)

      // reasoning_summary_part.added (index 0 is implied by output_item.added)
      // reasoning_summary_text.delta
      this.writeSSE(res, { type: 'response.reasoning_summary_text.delta', item_id: reasoningId, summary_index: 0, delta: this.reasoningText })
      await this.delay(this.chunkDelay)

      // reasoning_summary_part.done
      this.writeSSE(res, { type: 'response.reasoning_summary_part.done', item_id: reasoningId, summary_index: 0 })
      await this.delay(this.chunkDelay)

      // output_item.done (reasoning)
      this.writeSSE(res, { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: reasoningId } })
      await this.delay(this.chunkDelay)
    }

    // Message output item
    const msgId = `msg-${Date.now()}`
    const outputIndex = this.reasoningText ? 1 : 0
    this.writeSSE(res, {
      type: 'response.output_item.added',
      output_index: outputIndex,
      item: { type: 'message', id: msgId, status: 'in_progress', role: 'assistant', content: [] },
    })
    await this.delay(this.chunkDelay)

    this.writeSSE(res, {
      type: 'response.content_part.added',
      item_id: msgId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    })
    await this.delay(this.chunkDelay)

    // Stream text deltas word by word
    const words = responseText.split(' ')
    let outputText = ''
    for (let i = 0; i < words.length; i++) {
      const delta = i === 0 ? words[i] : ` ${words[i]}`
      outputText += delta
      this.writeSSE(res, {
        type: 'response.output_text.delta',
        item_id: msgId,
        output_index: outputIndex,
        content_index: 0,
        delta,
      })
      await this.delay(this.chunkDelay)
    }

    const outputTextPart = { type: 'output_text', text: outputText, annotations: [] }
    this.writeSSE(res, {
      type: 'response.output_text.done',
      item_id: msgId,
      output_index: outputIndex,
      content_index: 0,
      text: outputText,
    })
    await this.delay(this.chunkDelay)

    this.writeSSE(res, {
      type: 'response.content_part.done',
      item_id: msgId,
      output_index: outputIndex,
      content_index: 0,
      part: outputTextPart,
    })
    await this.delay(this.chunkDelay)

    // output_item.done (message)
    const messageItem = {
      type: 'message',
      id: msgId,
      status: 'completed',
      role: 'assistant',
      content: [outputTextPart],
    }
    this.writeSSE(res, { type: 'response.output_item.done', output_index: outputIndex, item: messageItem })
    await this.delay(this.chunkDelay)

    // response.completed
    const usage = {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: words.length,
      output_tokens_details: { reasoning_tokens: this.reasoningText ? this.reasoningText.length : 0 },
      total_tokens: 10 + words.length,
    }
    this.writeSSE(res, {
      type: 'response.completed',
      response: this.buildCompletedResponsesApiResponse({
        id: responseId,
        createdAt: created,
        model,
        output: [messageItem],
        usage,
      }),
    })
    res.end()
  }

  private async streamResponsesToolCall(res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const responseId = `resp-mock-${Date.now()}`
    const model = 'mock-model'
    const created = Math.floor(Date.now() / 1000)

    // response.created
    this.writeSSE(res, { type: 'response.created', response: { id: responseId, created_at: created, model } })
    await this.delay(this.chunkDelay)

    // Emit each tool call as a function_call item
    const output: Record<string, unknown>[] = []
    for (let i = 0; i < this.toolCalls.length; i++) {
      const tc = this.toolCalls[i]!
      const itemId = `fc-${i}-${Date.now()}`
      // output_item.added
      this.writeSSE(res, {
        type: 'response.output_item.added',
        output_index: i,
        item: {
          type: 'function_call',
          id: itemId,
          status: 'in_progress',
          call_id: tc.id,
          name: tc.function.name,
          arguments: '',
        },
      })
      await this.delay(this.chunkDelay)

      this.writeSSE(res, {
        type: 'response.function_call_arguments.delta',
        item_id: itemId,
        output_index: i,
        delta: tc.function.arguments,
      })
      await this.delay(this.chunkDelay)

      this.writeSSE(res, {
        type: 'response.function_call_arguments.done',
        item_id: itemId,
        output_index: i,
        arguments: tc.function.arguments,
      })
      await this.delay(this.chunkDelay)

      // output_item.done
      const item = {
        type: 'function_call',
        id: itemId,
        call_id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        status: 'completed',
      }
      this.writeSSE(res, {
        type: 'response.output_item.done',
        output_index: i,
        item,
      })
      output.push(item)
      await this.delay(this.chunkDelay)
    }

    // response.completed
    const usage = {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 15,
    }
    this.writeSSE(res, {
      type: 'response.completed',
      response: this.buildCompletedResponsesApiResponse({
        id: responseId,
        createdAt: created,
        model,
        output,
        usage,
      }),
    })
    res.end()
  }

  private buildCompletedResponsesApiResponse(input: {
    id: string
    createdAt: number
    model: string
    output: Record<string, unknown>[]
    usage: Record<string, unknown>
  }): Record<string, unknown> {
    return {
      id: input.id,
      object: 'response',
      created_at: input.createdAt,
      status: 'completed',
      error: null,
      incomplete_details: null,
      instructions: null,
      max_output_tokens: null,
      model: input.model,
      output: input.output,
      parallel_tool_calls: true,
      previous_response_id: null,
      reasoning: { effort: null, summary: null },
      store: false,
      temperature: 1,
      text: { format: { type: 'text' } },
      tool_choice: 'auto',
      tools: [],
      top_p: 1,
      truncation: 'disabled',
      usage: input.usage,
      user: null,
      metadata: {},
    }
  }

  // ── Anthropic Messages API (/v1/messages) ─────────────────────────────────

  private handleAnthropicMessages(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      this.recordRequest(req, body)
      this.turnCount++

      const parsedBody = AnthropicMessagesRequestJsonSchema.parse(body)

      // Check if this is a turn after tool_result (continuation)
      const hasToolResult = parsedBody.messages.some(m =>
        m.role === 'user' && m.content.some(c => c.type === 'tool_result'))

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      })

      if (hasToolResult) {
        // After tool execution, respond with final text
        void this.streamAnthropicTextResponse(res, 'Tool execution complete. The command ran successfully.')
      }
      else {
        // First turn: respond with a tool_use block to trigger canUseTool
        void this.streamAnthropicToolUseResponse(res)
      }
    })
  }

  private async streamAnthropicToolUseResponse(res: ServerResponse): Promise<void> {
    const msgId = `msg_mock_${Date.now()}`
    const toolUseId = `toolu_mock_${Date.now()}`

    // message_start
    this.writeSSE(res, {
      type: 'message_start',
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4-20250514',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    })
    await this.delay(this.chunkDelay)

    // content_block_start (tool_use)
    this.writeSSE(res, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: toolUseId, name: 'Bash', input: {} },
    })
    await this.delay(this.chunkDelay)

    // content_block_delta (input_json_delta)
    this.writeSSE(res, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"command":"echo hello","description":"Run echo command"}' },
    })
    await this.delay(this.chunkDelay)

    // content_block_stop
    this.writeSSE(res, { type: 'content_block_stop', index: 0 })
    await this.delay(this.chunkDelay)

    // message_delta (stop_reason: tool_use)
    this.writeSSE(res, {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 30 },
    })
    await this.delay(this.chunkDelay)

    // message_stop
    this.writeSSE(res, { type: 'message_stop' })
    res.end()
  }

  private async streamAnthropicTextResponse(res: ServerResponse, text: string): Promise<void> {
    const msgId = `msg_mock_${Date.now()}`

    this.writeSSE(res, {
      type: 'message_start',
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'claude-sonnet-4-20250514',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    })
    await this.delay(this.chunkDelay)

    this.writeSSE(res, {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })
    await this.delay(this.chunkDelay)

    this.writeSSE(res, {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    })
    await this.delay(this.chunkDelay)

    this.writeSSE(res, { type: 'content_block_stop', index: 0 })
    await this.delay(this.chunkDelay)

    this.writeSSE(res, {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 20 },
    })
    await this.delay(this.chunkDelay)

    this.writeSSE(res, { type: 'message_stop' })
    res.end()
  }

  // ── Claude Agent SDK (/v1/claude-agent/query) ──────────────────────────────

  private handleClaudeAgentQuery(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      this.recordRequest(req, body)
      this.turnCount++

      if (!this.claudeAgentScenario) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'No claudeAgentScenario configured' }))
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      })

      void this.streamClaudeAgentScenario(res, this.turnCount)
    })
  }

  private async streamClaudeAgentScenario(res: ServerResponse, turnCount: number): Promise<void> {
    const sessionId = 'mock-session-001'
    const msgs = buildClaudeAgentScenario(this.claudeAgentScenario!, sessionId, turnCount)

    for (const msg of msgs) {
      this.writeSSE(res, msg as unknown as Record<string, unknown>)
      await this.delay(this.chunkDelay)
    }

    res.end()
  }

  private writeSSE(res: ServerResponse, data: Record<string, unknown>): void {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }
}

// ── Claude Agent SDK scenario message builders ────────────────────────────────

interface MockSdkMessage {
  type: string
  subtype?: string
  [key: string]: unknown
}

function makeStreamEvent(opts: {
  eventType: 'content_block_start' | 'content_block_delta' | 'content_block_stop'
  index: number
  contentBlock?: Record<string, unknown>
  delta?: Record<string, unknown>
  parentToolUseId: string | null
  uuid: string
  sessionId: string
}): MockSdkMessage {
  const msg: MockSdkMessage = {
    type: 'stream_event',
    event: {
      type: opts.eventType,
      index: opts.index,
      ...(opts.contentBlock ? { content_block: opts.contentBlock } : {}),
      ...(opts.delta ? { delta: opts.delta } : {}),
    },
    parent_tool_use_id: opts.parentToolUseId,
    uuid: opts.uuid,
    session_id: opts.sessionId,
  }
  return msg
}

function makeUserMsg(opts: {
  toolResults: Array<{ tool_use_id: string, content: string, is_error?: boolean }>
  parentToolUseId: string | null
  uuid: string
  sessionId: string
}): MockSdkMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: opts.toolResults.map(tr => ({
        type: 'tool_result',
        tool_use_id: tr.tool_use_id,
        content: tr.content,
        ...(tr.is_error ? { is_error: true } : {}),
      })),
    },
    parent_tool_use_id: opts.parentToolUseId,
    uuid: opts.uuid,
    session_id: opts.sessionId,
  }
}

function makeAssistantMsg(opts: {
  content: Array<Record<string, unknown>>
  parentToolUseId: string | null
  uuid: string
  sessionId: string
}): MockSdkMessage {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: opts.content,
    },
    parent_tool_use_id: opts.parentToolUseId,
    uuid: opts.uuid,
    session_id: opts.sessionId,
  }
}

function makeResultMsg(sessionId: string): MockSdkMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: false,
    num_turns: 2,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_tokens: 0, cache_read_tokens: 0 },
    permission_denials: [],
    session_id: sessionId,
    uuid: `result-${sessionId}`,
  }
}

/**
 * Build pre-crafted SDKMessage sequences for Claude Agent mock scenarios.
 */
function buildClaudeAgentScenario(
  scenario: MockClaudeAgentScenario,
  sessionId: string,
  turnCount = 1,
): MockSdkMessage[] {
  switch (scenario) {
    case 'basic-chat':
      return buildBasicChat(sessionId)
    case 'tool-call':
      return buildToolCall(sessionId)
    case 'agent-subagent':
      return buildAgentSubagent(sessionId)
    case 'agent-subagent-deep':
      return buildAgentSubagentDeep(sessionId)
    case 'agent-parallel':
      return buildAgentParallel(sessionId)
    case 'approval-tool':
      return buildApprovalTool(sessionId, turnCount)
    default:
      return buildBasicChat(sessionId)
  }
}

function buildBasicChat(sessionId: string): MockSdkMessage[] {
  const msgs: MockSdkMessage[] = []

  // Parent reasoning
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'thinking', thinking: '' }, parentToolUseId: null, uuid: 'u1', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think about this...' }, parentToolUseId: null, uuid: 'u1', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: null, uuid: 'u1', sessionId }))

  // Parent text
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 1, contentBlock: { type: 'text', text: '' }, parentToolUseId: null, uuid: 'u1', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello! This is a basic response from the mock LLM.' }, parentToolUseId: null, uuid: 'u1', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 1, parentToolUseId: null, uuid: 'u1', sessionId }))

  msgs.push(makeResultMsg(sessionId))
  return msgs
}

function buildToolCall(sessionId: string): MockSdkMessage[] {
  const toolCallId = 'toolu_read_file_001'
  const msgs: MockSdkMessage[] = []

  msgs.push(makeAssistantMsg({
    content: [{
      type: 'tool_use',
      id: toolCallId,
      name: 'read_file',
      input: { path: 'demo.txt' },
    }],
    parentToolUseId: null,
    uuid: 'u-read-file',
    sessionId,
  }))
  msgs.push(makeUserMsg({
    toolResults: [{ tool_use_id: toolCallId, content: 'Mock file contents' }],
    parentToolUseId: null,
    uuid: 'u-read-file-result',
    sessionId,
  }))
  msgs.push(makeResultMsg(sessionId))
  return msgs
}

/**
 * Parent spawns Agent → subagent does work → Agent returns → parent wraps up.
 * KEY: subagent events have parent_tool_use_id set, parent events have null.
 */
function buildAgentSubagent(sessionId: string): MockSdkMessage[] {
  const agentToolCallId = 'call_agent_main_001'
  const subToolCallId = 'call_sub_grep_001'
  const msgs: MockSdkMessage[] = []

  // ── Parent: reasoning ──
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'thinking', thinking: '' }, parentToolUseId: null, uuid: 'u-parent', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'User wants me to explore the codebase. Let me spawn an Explorer subagent.' }, parentToolUseId: null, uuid: 'u-parent', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: null, uuid: 'u-parent', sessionId }))

  // ── Parent: text ──
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 1, contentBlock: { type: 'text', text: '' }, parentToolUseId: null, uuid: 'u-parent', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Let me spawn an Explorer agent to investigate.' }, parentToolUseId: null, uuid: 'u-parent', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 1, parentToolUseId: null, uuid: 'u-parent', sessionId }))

  // ── Parent: Agent tool_use START ──
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 2, contentBlock: { type: 'tool_use', id: agentToolCallId, name: 'Agent', input: {} }, parentToolUseId: null, uuid: 'u-parent', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"description":"Explore codebase","prompt":"Search for dead code and unused files"}' }, parentToolUseId: null, uuid: 'u-parent', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 2, parentToolUseId: null, uuid: 'u-parent', sessionId }))

  // ═══════════════════════════════════════════════════════════════
  // SUBAGENT events (parent_tool_use_id = agentToolCallId)
  // ═══════════════════════════════════════════════════════════════

  // Subagent: reasoning
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'thinking', thinking: '' }, parentToolUseId: agentToolCallId, uuid: 'u-sub', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'I need to search for dead code. Let me start with grep.' }, parentToolUseId: agentToolCallId, uuid: 'u-sub', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: agentToolCallId, uuid: 'u-sub', sessionId }))

  // Subagent: text
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 1, contentBlock: { type: 'text', text: '' }, parentToolUseId: agentToolCallId, uuid: 'u-sub', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'I will systematically search for dead code.' }, parentToolUseId: agentToolCallId, uuid: 'u-sub', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 1, parentToolUseId: agentToolCallId, uuid: 'u-sub', sessionId }))

  // Subagent: tool_use (Grep)
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 2, contentBlock: { type: 'tool_use', id: subToolCallId, name: 'Grep', input: {} }, parentToolUseId: agentToolCallId, uuid: 'u-sub', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"pattern":"unused","output_mode":"files_with_matches"}' }, parentToolUseId: agentToolCallId, uuid: 'u-sub', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 2, parentToolUseId: agentToolCallId, uuid: 'u-sub', sessionId }))

  // Subagent: tool_result (Grep output)
  msgs.push(makeUserMsg({ toolResults: [{ tool_use_id: subToolCallId, content: 'Found 12 unused imports in 5 files' }], parentToolUseId: agentToolCallId, uuid: 'u-sub-tr', sessionId }))

  // Subagent: more text after tool result
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: agentToolCallId, uuid: 'u-sub-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Found 12 unused imports across 5 files. These can be safely removed.' }, parentToolUseId: agentToolCallId, uuid: 'u-sub-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: agentToolCallId, uuid: 'u-sub-2', sessionId }))

  // ═══════════════════════════════════════════════════════════════
  // Back to PARENT
  // ═══════════════════════════════════════════════════════════════

  // Agent tool_result (subagent's final output returned to parent)
  msgs.push(makeUserMsg({ toolResults: [{ tool_use_id: agentToolCallId, content: 'Subagent completed: found 12 unused imports in 5 files.' }], parentToolUseId: null, uuid: 'u-parent-tr', sessionId }))

  // Parent: reasoning about subagent result
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'thinking', thinking: '' }, parentToolUseId: null, uuid: 'u-parent-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'The Explorer found 12 unused imports. Let me summarize.' }, parentToolUseId: null, uuid: 'u-parent-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: null, uuid: 'u-parent-2', sessionId }))

  // Parent: final text
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 1, contentBlock: { type: 'text', text: '' }, parentToolUseId: null, uuid: 'u-parent-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'The Explorer subagent found 12 unused imports across 5 source files. Here they are...' }, parentToolUseId: null, uuid: 'u-parent-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 1, parentToolUseId: null, uuid: 'u-parent-2', sessionId }))

  msgs.push(makeResultMsg(sessionId))
  return msgs
}

/** Subagent spawns its own Agent (depth=2). Tests nested parent_tool_use_id chaining. */
function buildAgentSubagentDeep(sessionId: string): MockSdkMessage[] {
  const parentAgentId = 'call_agent_l1'
  const childAgentId = 'call_agent_l2'
  const childToolId = 'call_child_grep'
  const msgs: MockSdkMessage[] = []

  // Parent text
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: null, uuid: 'u-p', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me dispatch a deep exploration agent.' }, parentToolUseId: null, uuid: 'u-p', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: null, uuid: 'u-p', sessionId }))

  // Parent → Agent L1
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: parentAgentId, name: 'Agent', input: {} }, parentToolUseId: null, uuid: 'u-p', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"description":"Deep explorer","prompt":"Explore deeply"}' }, parentToolUseId: null, uuid: 'u-p', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 1, parentToolUseId: null, uuid: 'u-p', sessionId }))

  // L1 subagent text (parent_tool_use_id = parentAgentId)
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: parentAgentId, uuid: 'u-l1', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will spawn a deeper agent to look at the packages directory.' }, parentToolUseId: parentAgentId, uuid: 'u-l1', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: parentAgentId, uuid: 'u-l1', sessionId }))

  // L1 → Agent L2 (parent_tool_use_id = parentAgentId, since this is still inside L1's turn)
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: childAgentId, name: 'Agent', input: {} }, parentToolUseId: parentAgentId, uuid: 'u-l1', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"description":"Package inspector","prompt":"Inspect packages/"}' }, parentToolUseId: parentAgentId, uuid: 'u-l1', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 1, parentToolUseId: parentAgentId, uuid: 'u-l1', sessionId }))

  // L2 subagent work (parent_tool_use_id = childAgentId)
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: childAgentId, uuid: 'u-l2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Inspecting packages directory...' }, parentToolUseId: childAgentId, uuid: 'u-l2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: childAgentId, uuid: 'u-l2', sessionId }))

  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: childToolId, name: 'Read', input: {} }, parentToolUseId: childAgentId, uuid: 'u-l2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"packages/db/package.json"}' }, parentToolUseId: childAgentId, uuid: 'u-l2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 1, parentToolUseId: childAgentId, uuid: 'u-l2', sessionId }))

  msgs.push(makeUserMsg({ toolResults: [{ tool_use_id: childToolId, content: '{\"name\":\"@cradle/db\"}' }], parentToolUseId: childAgentId, uuid: 'u-l2-tr', sessionId }))

  // L2 result
  msgs.push(makeUserMsg({ toolResults: [{ tool_use_id: childAgentId, content: 'Package inspection complete.' }], parentToolUseId: parentAgentId, uuid: 'u-l1-tr2', sessionId }))

  // L1 wraps up
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: parentAgentId, uuid: 'u-l1-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Package inspection is complete.' }, parentToolUseId: parentAgentId, uuid: 'u-l1-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: parentAgentId, uuid: 'u-l1-2', sessionId }))

  // L1 result
  msgs.push(makeUserMsg({ toolResults: [{ tool_use_id: parentAgentId, content: 'Deep exploration complete.' }], parentToolUseId: null, uuid: 'u-p-tr', sessionId }))

  // Parent final text
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: null, uuid: 'u-p-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The deep exploration agent completed successfully.' }, parentToolUseId: null, uuid: 'u-p-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: null, uuid: 'u-p-2', sessionId }))

  msgs.push(makeResultMsg(sessionId))
  return msgs
}

/** Parent spawns 2 Agents in parallel. Tests parallel subagent routing. */
function buildAgentParallel(sessionId: string): MockSdkMessage[] {
  const agentA = 'call_agent_a'
  const agentB = 'call_agent_b'
  const toolA = 'call_tool_a'
  const toolB = 'call_tool_b'
  const msgs: MockSdkMessage[] = []

  // Parent text
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: null, uuid: 'u-p', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me run two investigations in parallel.' }, parentToolUseId: null, uuid: 'u-p', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: null, uuid: 'u-p', sessionId }))

  // Agent A
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: agentA, name: 'Agent', input: {} }, parentToolUseId: null, uuid: 'u-p', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"description":"Search src","prompt":"Search src/"}' }, parentToolUseId: null, uuid: 'u-p', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 1, parentToolUseId: null, uuid: 'u-p', sessionId }))

  // Agent B
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 2, contentBlock: { type: 'tool_use', id: agentB, name: 'Agent', input: {} }, parentToolUseId: null, uuid: 'u-p', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"description":"Search packages","prompt":"Search packages/"}' }, parentToolUseId: null, uuid: 'u-p', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 2, parentToolUseId: null, uuid: 'u-p', sessionId }))

  // Agent A's work
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: agentA, uuid: 'u-a', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Searching src directory...' }, parentToolUseId: agentA, uuid: 'u-a', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: agentA, uuid: 'u-a', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: toolA, name: 'Grep', input: {} }, parentToolUseId: agentA, uuid: 'u-a', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pattern":"export"}' }, parentToolUseId: agentA, uuid: 'u-a', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 1, parentToolUseId: agentA, uuid: 'u-a', sessionId }))
  msgs.push(makeUserMsg({ toolResults: [{ tool_use_id: toolA, content: 'Found 50 exports in src/' }], parentToolUseId: agentA, uuid: 'u-a-tr', sessionId }))

  // Agent B's work
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: agentB, uuid: 'u-b', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Searching packages directory...' }, parentToolUseId: agentB, uuid: 'u-b', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: agentB, uuid: 'u-b', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: toolB, name: 'Glob', input: {} }, parentToolUseId: agentB, uuid: 'u-b', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pattern":"**/*.ts"}' }, parentToolUseId: agentB, uuid: 'u-b', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 1, parentToolUseId: agentB, uuid: 'u-b', sessionId }))
  msgs.push(makeUserMsg({ toolResults: [{ tool_use_id: toolB, content: 'Found 120 .ts files in packages/' }], parentToolUseId: agentB, uuid: 'u-b-tr', sessionId }))

  // Agent A result
  msgs.push(makeUserMsg({ toolResults: [{ tool_use_id: agentA, content: 'Src search complete: 50 exports found.' }], parentToolUseId: null, uuid: 'u-p-tra', sessionId }))
  // Agent B result
  msgs.push(makeUserMsg({ toolResults: [{ tool_use_id: agentB, content: 'Packages search complete: 120 .ts files found.' }], parentToolUseId: null, uuid: 'u-p-trb', sessionId }))

  // Parent final text
  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: null, uuid: 'u-p-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Both agents completed. Found 50 exports in src and 120 .ts files in packages.' }, parentToolUseId: null, uuid: 'u-p-2', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: null, uuid: 'u-p-2', sessionId }))

  msgs.push(makeResultMsg(sessionId))
  return msgs
}

/**
 * Emits a Claude Agent plan approval request, then completes on the follow-up
 * turn triggered by approving the plan.
 */
function buildApprovalTool(sessionId: string, turnCount: number): MockSdkMessage[] {
  if (turnCount > 1) {
    const msgs: MockSdkMessage[] = []
    msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: null, uuid: 'u-approval-final', sessionId }))
    msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Approved. The command execution plan completed.' }, parentToolUseId: null, uuid: 'u-approval-final', sessionId }))
    msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: null, uuid: 'u-approval-final', sessionId }))
    msgs.push(makeResultMsg(sessionId))
    return msgs
  }

  const toolCallId = 'toolu_plan_approval_001'
  const msgs: MockSdkMessage[] = []
  const plan = '1. Run echo hello\n2. Report the command output'

  msgs.push(makeStreamEvent({ eventType: 'content_block_start', index: 0, contentBlock: { type: 'text', text: '' }, parentToolUseId: null, uuid: 'u1', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I prepared a plan that needs approval.' }, parentToolUseId: null, uuid: 'u1', sessionId }))
  msgs.push(makeStreamEvent({ eventType: 'content_block_stop', index: 0, parentToolUseId: null, uuid: 'u1', sessionId }))
  msgs.push(makeAssistantMsg({
    content: [{
      type: 'tool_use',
      id: toolCallId,
      name: 'ExitPlanMode',
      input: { plan },
    }],
    parentToolUseId: null,
    uuid: 'u-plan-approval',
    sessionId,
  }))
  msgs.push(makeResultMsg(sessionId))
  return msgs
}
