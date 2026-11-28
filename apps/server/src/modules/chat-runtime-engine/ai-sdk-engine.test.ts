import type { UIMessage } from 'ai'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import { describe, expect, it } from 'vitest'

import type { TokenUsage } from './ai-sdk-engine'
import { buildModelMessages, executeAiSdkTurn } from './ai-sdk-engine'

describe('buildModelMessages', () => {
  it('preserves user file parts when building AI SDK model messages', async () => {
    const userMessage: UIMessage = {
      id: 'user-with-file',
      role: 'user',
      parts: [
        { type: 'text', text: 'Read this image' },
        {
          type: 'file',
          mediaType: 'image/png',
          filename: 'diagram.png',
          url: 'data:image/png;base64,test',
        },
      ],
    }

    const messages = await buildModelMessages(undefined, userMessage)

    expect(messages).toHaveLength(1)
    const [converted] = messages
    expect(converted?.role).toBe('user')
    const content = converted?.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) {
      throw new TypeError('expected array content')
    }
    expect(content[0]).toMatchObject({ type: 'text', text: 'Read this image' })
    // AI SDK 7 canonicalizes file data into a tagged variant carrying a URL instance
    const filePart = content[1] as {
      type: string
      mediaType?: string
      filename?: string
      data?: { type: string, url: URL }
    }
    expect(filePart.type).toBe('file')
    expect(filePart.mediaType).toBe('image/png')
    expect(filePart.filename).toBe('diagram.png')
    expect(filePart.data?.type).toBe('url')
    expect(filePart.data?.url?.href).toBe('data:image/png;base64,test')
  })

  it('degrades Cradle plugin context parts to text for AI SDK model messages', async () => {
    const userMessage: UIMessage = {
      id: 'user-with-plugin',
      role: 'user',
      parts: [
        { type: 'text', text: 'Use this' },
        {
          type: 'data-cradle-plugin',
          data: {
            type: 'data-cradle-plugin',
            pluginName: '@cradle/browser-use',
            displayName: 'Browser Use',
            description: 'Browser automation',
            routeSegment: 'browser-use',
            capabilities: [
              { id: '@cradle/browser-use:mcp.browser-use', type: 'mcp-server', layer: 'server', label: 'Browser automation MCP server' },
            ],
            mcpServers: ['browser-use'],
          },
        } as UIMessage['parts'][number],
      ],
    }

    await expect(buildModelMessages(undefined, userMessage)).resolves.toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Use this' },
          { type: 'text', text: 'Selected Cradle plugin @Browser Use. Browser automation Capabilities: mcp-server:server. MCP servers: browser-use.' },
        ],
      },
    ])
  })
})

describe('executeAiSdkTurn', () => {
  it('emits usage before yielding the terminal finish chunk', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: '0' },
            { type: 'text-delta', id: '0', delta: 'hello' },
            { type: 'text-end', id: '0' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: {
                  total: 3,
                  text: 3,
                  reasoning: undefined,
                },
              },
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      },
    })
    let usage: TokenUsage | null = null

    for await (const chunk of executeAiSdkTurn({
      model,
      messages: [{ role: 'user', content: 'hello' }],
      onUsage: (nextUsage) => { usage = nextUsage },
    })) {
      if (chunk.type === 'finish') {
        break
      }
    }

    expect(usage).toEqual({
      promptTokens: 10,
      completionTokens: 3,
      totalTokens: 13,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 0,
    })
  })

  it('forwards the served service tier as the OpenAI request field', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: '0' },
            { type: 'text-delta', id: '0', delta: 'fast' },
            { type: 'text-end', id: '0' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      },
    })

    for await (const chunk of executeAiSdkTurn({
      model,
      messages: [{ role: 'user', content: 'hello' }],
      providerOptions: { thinkingEffort: 'high' },
      serviceTier: 'priority',
    })) {
      if (chunk.type === 'finish') {
        break
      }
    }

    expect(model.doStreamCalls[0]?.providerOptions).toEqual({
      openai: {
        reasoningEffort: 'high',
        serviceTier: 'priority',
      },
    })
  })

  it('sends no OpenAI provider options when no effort and no tier are set', async () => {
    const model = new MockLanguageModelV3({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: '0' },
            { type: 'text-delta', id: '0', delta: 'plain' },
            { type: 'text-end', id: '0' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      },
    })

    for await (const chunk of executeAiSdkTurn({
      model,
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      if (chunk.type === 'finish') {
        break
      }
    }

    expect(model.doStreamCalls[0]?.providerOptions ?? undefined).toBeUndefined()
  })
})
