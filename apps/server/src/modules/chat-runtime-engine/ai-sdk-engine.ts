// AI SDK Engine — unified agent execution using Vercel AI SDK streamText
// Yields UIMessageChunk directly — no intermediate timeline abstraction

import type { LanguageModel, LanguageModelUsage, ModelMessage, ToolSet, UIMessage, UIMessageChunk } from 'ai'
import { convertToModelMessages, stepCountIs, streamText } from 'ai'

import { aiTelemetryEnabled } from '../../telemetry/config'
import { readChatPluginContextPart, readChatSkillContextPart } from '../chat-runtime/context-parts'
import type { ChatThinkingEffort } from '../chat-runtime/runtime-provider-types'
import type { BudgetConfig } from '../usage/budget'
import { checkDailyBudget, checkTurnBudget } from '../usage/budget'
import { estimateCost } from '../usage/pricing'
import { compactByWindow, compactWithSummary, isContextOverflow, resolveCompactionConfig } from './compaction'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface AiSdkEngineInput {
  model: LanguageModel
  messages: ModelMessage[]
  initialMessage?: UIMessage
  originalMessages?: UIMessage[]
  system?: string
  tools?: ToolSet
  maxSteps?: number
  abortSignal?: AbortSignal
  abortController?: AbortController
  providerOptions?: {
    thinkingEffort?: ChatThinkingEffort
  }
  /** Callback to receive usage data when available */
  onUsage?: (usage: TokenUsage) => void
  /** Callback for per-step usage data */
  onStepFinish?: (step: {
    stepNumber: number
    stepType: string
    modelId?: string
    usage: TokenUsage
  }) => void
  /** Context window of the model in tokens (for auto-compaction) */
  contextWindow?: number
  /** Compaction strategy: 'window' drops old messages, 'summarize' generates a summary first */
  compactionStrategy?: 'window' | 'summarize'
  /** Optional budget limits for cost control */
  budgetConfig?: BudgetConfig
  /** Called when a budget limit is exceeded (lets the caller decide how to handle it) */
  onBudgetExceeded?: (reason: string) => void
  /** Returns the current day's total cost (for daily budget checks) */
  getDailyCost?: () => number
  /** Chat session ID for Langfuse session correlation */
  chatSessionId?: string
}

function createAiSdkStreamResult(input: AiSdkEngineInput): {
  result: ReturnType<typeof streamText>
  effectiveAbortSignal: AbortSignal | undefined
} {
  const {
    model,
    messages,
    system,
    tools,
    maxSteps = 1,
    abortSignal,
    abortController,
    onStepFinish,
    contextWindow,
    compactionStrategy = 'window',
    budgetConfig,
    onBudgetExceeded,
    getDailyCost,
    chatSessionId,
  } = input

  const effectiveAbortSignal = abortController?.signal ?? abortSignal
  const reasoningEffort = readOpenAiReasoningEffort(input.providerOptions?.thinkingEffort)
  const providerOptions = reasoningEffort
    ? {
        openai: {
          reasoningEffort,
        },
      }
    : undefined
  let accumulatedTurnCost = 0

  const compactionConfig = resolveCompactionConfig({
    contextWindow,
  })

  const result = streamText({
    model,
    messages,
    system,
    tools,
    providerOptions,
    stopWhen: maxSteps > 1 ? stepCountIs(maxSteps) : undefined,
    abortSignal: effectiveAbortSignal,
    experimental_telemetry: aiTelemetryEnabled()
      ? {
          isEnabled: true,
          metadata: {
            'langfuse.session.id': chatSessionId ?? '',
            'langfuse.trace.name': 'ai-sdk-chat',
          },
        }
      : undefined,
    onStepFinish: (step) => {
      if (onStepFinish && step.usage) {
        const hasToolCalls = step.toolCalls && step.toolCalls.length > 0
        const inferredStepType = step.stepNumber === 0
          ? 'initial'
          : hasToolCalls
            ? 'tool-result'
            : 'continue'

        onStepFinish({
          stepNumber: step.stepNumber,
          stepType: inferredStepType,
          modelId: step.model?.modelId,
          usage: {
            promptTokens: step.usage.inputTokens ?? 0,
            completionTokens: step.usage.outputTokens ?? 0,
            totalTokens: step.usage.totalTokens ?? (step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0),
          },
        })
      }

      if (budgetConfig && step.usage) {
        const stepCost = estimateCost(step.model?.modelId ?? '', {
          promptTokens: step.usage.inputTokens ?? 0,
          completionTokens: step.usage.outputTokens ?? 0,
        })
        accumulatedTurnCost += stepCost

        const turnCheck = checkTurnBudget(accumulatedTurnCost, budgetConfig.maxCostPerTurn)
        if (!turnCheck.allowed) {
          onBudgetExceeded?.(turnCheck.reason!)
          abortController?.abort(turnCheck.reason)
          return
        }

        if (getDailyCost && budgetConfig.maxCostPerDay) {
          const dailyCost = getDailyCost() + accumulatedTurnCost
          const dailyCheck = checkDailyBudget(dailyCost, budgetConfig.maxCostPerDay)
          if (!dailyCheck.allowed) {
            onBudgetExceeded?.(dailyCheck.reason!)
            abortController?.abort(dailyCheck.reason)
          }
        }
      }
    },
    prepareStep: async ({ steps, messages: currentMessages }) => {
      try {
        if (steps.length === 0) {
          return undefined
        }

        const lastStep = steps.at(-1)
        const usage = lastStep?.usage
        if (!usage) {
          return undefined
        }

        if (isContextOverflow({
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        }, compactionConfig)) {
          if (currentMessages.length > compactionConfig.keepRecentMessages) {
            if (compactionStrategy === 'summarize') {
              const compacted = await compactWithSummary(currentMessages, model)
              return { messages: compacted }
            }
            return { messages: compactByWindow(currentMessages) }
          }
        }
        return undefined
      }
      catch {
        return undefined
      }
    },
  })

  return { result, effectiveAbortSignal }
}

function readOpenAiReasoningEffort(effort: ChatThinkingEffort | undefined): ChatThinkingEffort | null {
  return effort ?? null
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return
  }

  throw createAbortError()
}

function createAbortError(): Error {
  const err = new Error('AI SDK turn aborted')
  err.name = 'AbortError'
  return err
}

async function nextOrAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal | undefined): Promise<IteratorResult<T>> {
  if (!signal) {
    return iterator.next()
  }

  throwIfAborted(signal)

  return await new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(createAbortError())
    }

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
    }

    signal.addEventListener('abort', onAbort, { once: true })
    iterator.next().then((result) => {
      cleanup()
      resolve(result)
    }, (error) => {
      cleanup()
      reject(error)
    })
  })
}

function toTokenUsage(usage: LanguageModelUsage): TokenUsage {
  return {
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
  }
}

function createUsageEmitter(onUsage?: (usage: TokenUsage) => void): {
  emitLanguageModelUsage: (usage: LanguageModelUsage | null | undefined) => void
  emitResultUsage: (result: ReturnType<typeof streamText>) => Promise<void>
} {
  let emitted = false

  const emitLanguageModelUsage = (usage: LanguageModelUsage | null | undefined): void => {
    if (!onUsage || emitted || !usage) {
      return
    }

    emitted = true
    try {
      onUsage(toTokenUsage(usage))
    }
    catch {
      // Usage extraction failure is non-fatal
    }
  }

  return {
    emitLanguageModelUsage,
    emitResultUsage: async (result) => {
      if (!onUsage || emitted) {
        return
      }

      try {
        emitLanguageModelUsage(await result.usage)
      }
      catch {
        // Usage extraction failure is non-fatal
      }
    },
  }
}

/**
 * Execute an AI SDK agent turn, yielding UIMessageChunk directly.
 *
 * Uses AI SDK's `streamText` + `toUIMessageStream()` to get native
 * UIMessageChunk events — no custom timeline abstraction needed.
 */
export async function* executeAiSdkTurn(input: AiSdkEngineInput): AsyncGenerator<UIMessageChunk, void, void> {
  const { onUsage } = input
  const { result, effectiveAbortSignal } = createAiSdkStreamResult(input)
  const originalMessages = input.originalMessages ?? (input.initialMessage ? [input.initialMessage] : undefined)
  const usageEmitter = createUsageEmitter(onUsage)

  // Use toUIMessageStream() to get native UIMessageChunk events
  const uiStream = result.toUIMessageStream({
    generateMessageId: input.initialMessage ? () => input.initialMessage!.id : undefined,
    originalMessages,
    messageMetadata: ({ part }) => {
      if (part.type === 'finish') {
        usageEmitter.emitLanguageModelUsage(part.totalUsage)
      }
      return undefined
    },
  })
  const iterator = uiStream[Symbol.asyncIterator]()

  while (true) {
    const { done, value } = await nextOrAbort(iterator, effectiveAbortSignal)
    if (done) {
      break
    }

    yield value
  }

  await usageEmitter.emitResultUsage(result)
}

export async function buildModelMessages(
  history: UIMessage[] | undefined,
  message: UIMessage,
  maxMessages = 50,
): Promise<ModelMessage[]> {
  const result: UIMessage[] = []

  if (history && history.length > 0) {
    const effective = history.length > maxMessages
      ? history.slice(-maxMessages)
      : history

    const startIdx = effective[0]?.role === 'assistant' ? 1 : 0
    for (let i = startIdx; i < effective.length; i++) {
      result.push(effective[i]!)
    }
  }

  result.push(message)
  return convertToModelMessages(result.map(normalizeCustomContextPartsForModel))
}

function normalizeCustomContextPartsForModel(message: UIMessage): UIMessage {
  if (message.role !== 'user') {
    return message
  }
  const parts = message.parts.flatMap((part): UIMessage['parts'] => {
    const skillPart = readChatSkillContextPart(part)
    if (skillPart) {
      return [{
        type: 'text',
        text: `Selected Cradle skill $${skillPart.name}. ${skillPart.description ?? ''}`.trim(),
      } as UIMessage['parts'][number]]
    }
    const pluginPart = readChatPluginContextPart(part)
    if (pluginPart) {
      const capabilities = pluginPart.capabilities.map(capability => `${capability.type}:${capability.layer}`).join(', ')
      const mcpServers = pluginPart.mcpServers.length > 0 ? ` MCP servers: ${pluginPart.mcpServers.join(', ')}.` : ''
      const description = pluginPart.description ? ` ${pluginPart.description}` : ''
      return [{
        type: 'text',
        text: `Selected Cradle plugin @${pluginPart.displayName}.${description}${capabilities ? ` Capabilities: ${capabilities}.` : ''}${mcpServers}`,
      } as UIMessage['parts'][number]]
    }
    return [part]
  })
  return { ...message, parts }
}
