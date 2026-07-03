/**
 * Output: AI SDK UIMessageChunk events projected from opencode message parts.
 * Input: opencode session.prompt response parts.
 * Position: opencode provider package event mapper between SDK-native parts and Chat Runtime chunks.
 */

import type { AssistantMessage as OpencodeAssistantMessage, Part as OpencodePart } from '@opencode-ai/sdk'
import type { UIMessageChunk } from 'ai'

import type { TokenUsage } from '../../chat-runtime/runtime-provider-types'
import { providerChunk } from '../kit/chunk-mapper'
import { buildOpencodeToolInput, buildOpencodeToolOutput } from './tools/mapper'

export interface OpencodeChunkMapperResult {
  chunks: UIMessageChunk[]
  usage: TokenUsage | null
}

export function mapOpencodePromptResultToChunks(input: {
  info: OpencodeAssistantMessage
  parts: OpencodePart[]
}): OpencodeChunkMapperResult {
  const chunks: UIMessageChunk[] = []
  for (const part of input.parts) {
    chunks.push(...mapOpencodePartToChunks(part))
  }
  chunks.push(providerChunk.finish(readFinishReason(input.info.finish)))
  return {
    chunks,
    usage: {
      promptTokens: input.info.tokens.input,
      completionTokens: input.info.tokens.output + input.info.tokens.reasoning,
      totalTokens: input.info.tokens.input + input.info.tokens.output + input.info.tokens.reasoning,
    },
  }
}

function mapOpencodePartToChunks(part: OpencodePart): UIMessageChunk[] {
  switch (part.type) {
    case 'text':
      return providerChunk.textBlock(part.id, part.text)
    case 'reasoning':
      return providerChunk.reasoningBlock(part.id, part.text)
    case 'tool':
      return mapOpencodeToolPartToChunks(part)
    case 'file':
      return [projectFilePart(part)]
    case 'patch':
      return [{
        type: 'data-runtime-event',
        data: {
          kind: 'opencode.patch',
          hash: part.hash,
          files: part.files,
        },
      }]
    case 'snapshot':
      return [{
        type: 'data-runtime-event',
        data: {
          kind: 'opencode.snapshot',
          snapshot: part.snapshot,
        },
      }]
    case 'step-start':
    case 'step-finish':
    case 'agent':
    case 'retry':
    case 'compaction':
    case 'subtask':
      return [{
        type: 'data-runtime-event',
        data: {
          kind: `opencode.${part.type}`,
          part,
        },
      }]
  }
}

function mapOpencodeToolPartToChunks(part: Extract<OpencodePart, { type: 'tool' }>): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [
    providerChunk.toolInputStart(part.callID, part.tool),
    providerChunk.toolInputAvailable({
      toolCallId: part.callID,
      toolName: part.tool,
      input: buildOpencodeToolInput(part),
    }),
  ]

  switch (part.state.status) {
    case 'completed':
    case 'running':
    case 'pending':
      chunks.push(providerChunk.toolOutputAvailable({
        toolCallId: part.callID,
        output: buildOpencodeToolOutput(part),
      }))
      return chunks
    case 'error':
      chunks.push(providerChunk.toolOutputError(part.callID, part.state.error))
      return chunks
  }
}

function projectFilePart(part: Extract<OpencodePart, { type: 'file' }>): UIMessageChunk {
  return providerChunk.file({
    mediaType: part.mime,
    url: part.url,
  })
}

function readFinishReason(finish: string | undefined): Extract<UIMessageChunk, { type: 'finish' }>['finishReason'] {
  switch (finish) {
    case 'length':
      return 'length'
    case 'error':
      return 'error'
    case 'cancelled':
    case 'abort':
      return 'stop'
    default:
      return 'stop'
  }
}
