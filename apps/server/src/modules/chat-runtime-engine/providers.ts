// AI SDK provider factory — creates LanguageModel instances from provider config

import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

export type ApiFormat = 'openai' | 'anthropic' | 'google'

export interface ModelConfig {
  apiFormat: ApiFormat
  apiKey: string
  baseUrl?: string
  modelId: string
  /** When 'responses', use Responses API (reasoning support). When 'chat-completions', use legacy Chat Completions API. Default: 'chat-completions'. */
  apiMode?: 'responses' | 'chat-completions'
}

/**
 * Detect API format from baseUrl heuristics.
 * Falls back to 'openai' (most compatible).
 */
export function detectApiFormat(baseUrl: string | undefined): ApiFormat {
  if (!baseUrl) {
    return 'openai'
  }
  const lower = baseUrl.toLowerCase()
  if (lower.includes('anthropic')) {
    return 'anthropic'
  }
  if (lower.includes('generativelanguage.googleapis.com') || lower.includes('google')) {
    return 'google'
  }
  return 'openai'
}

/**
 * Create an AI SDK LanguageModel from config.
 * Supports OpenAI-compatible, Anthropic, and Google providers.
 *
 * Note: For OpenAI format, we explicitly use `.chat()` to hit `/chat/completions`
 * (not `/responses`) — this is required for third-party OpenAI-compatible APIs.
 */
export function createLanguageModel(config: ModelConfig): LanguageModel {
  switch (config.apiFormat) {
    case 'openai': {
      const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      })
      // 'responses' uses the Responses API (supports reasoning/thinking)
      // 'chat-completions' uses legacy Chat Completions API (compatible with third-party APIs)
      if (config.apiMode === 'responses') {
        return provider(config.modelId)
      }
      return provider.chat(config.modelId)
    }
    case 'anthropic': {
      const provider = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      })
      return provider(config.modelId)
    }
    case 'google': {
      const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      })
      return provider(config.modelId)
    }
  }
}
