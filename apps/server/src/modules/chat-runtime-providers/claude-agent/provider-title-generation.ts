/**
 * Title generation helper for Claude Agent provider.
 * Separated to avoid circular dependencies and type casting issues.
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'

import type { GetCapabilitiesInput, RuntimeProviderTargetProfile, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import { ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import { readTrustedClaudeAgentConfig } from '../../provider-contracts/provider-base'
import { createBoundedTextCollector } from '../bounded-text-collector'
import { buildClaudeQueryOptions, createClaudeStderrSink } from './input-projector'
import type { ClaudeAgentProviderDeps, ClaudeTitleGenerationThinkingEffort } from './types'

const CLAUDE_SESSION_TITLE_MAX_LENGTH = 60
const CLAUDE_SESSION_TITLE_TIMEOUT_MS = 30000

const CLAUDE_SESSION_TITLE_PROMPT_PREFIX = [
  'You are naming a Claude Agent task session.',
  'Generate a concise UI title for the user prompt below.',
  `Keep it at or below ${CLAUDE_SESSION_TITLE_MAX_LENGTH} characters when possible.`,
  'Use the same language as the user prompt.',
  'Do not answer the prompt.',
  'Do not use quotes.',
  'Output only the title text.',
].join('\n')

export async function generateClaudeSessionTitle(input: {
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  promptText: string
  modelId: string | null
  thinkingEffort: ClaudeTitleGenerationThinkingEffort
  workspaceId?: string | null
  workspacePath: string
  agentId: string | null
  deps: ClaudeAgentProviderDeps
  signal: AbortSignal
}): Promise<string | null> {
  const titlePrompt = `${CLAUDE_SESSION_TITLE_PROMPT_PREFIX}\n\n${input.promptText}`
  const abortController = new AbortController()

  const timeout = setTimeout(() => abortController.abort(), CLAUDE_SESSION_TITLE_TIMEOUT_MS)
  const abortTitleRead = () => abortController.abort()
  input.signal.addEventListener('abort', abortTitleRead, { once: true })

  // Declared outside `try` so the catch block can enrich the surfaced error
  // with the captured stderr when the title-generation process exits non-zero.
  const stderrSink = createClaudeStderrSink()

  try {
    const config = readTrustedClaudeAgentConfig(input.profile.configJson)
    const titleRuntimeInput = {
      runtimeSession: input.runtimeSession,
      profile: input.profile,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      agentId: input.agentId,
      modelId: input.modelId ?? undefined,
    } satisfies GetCapabilitiesInput
    const queryOptions: Options = buildClaudeQueryOptions({
      deps: input.deps,
      input: titleRuntimeInput,
      abortController,
      persistSession: false,
      attachPermissionHandler: false,
    })
    queryOptions.permissionMode = 'bypassPermissions'
    queryOptions.allowDangerouslySkipPermissions = true
    queryOptions.model = input.modelId ?? config.model ?? queryOptions.model
    queryOptions.effort = input.thinkingEffort === 'minimal' ? 'low' : input.thinkingEffort
    queryOptions.tools = []
    delete queryOptions.mcpServers
    delete queryOptions.skills

    queryOptions.stderr = stderrSink.onStderr

    const titleQuery = query({
      prompt: titlePrompt,
      options: queryOptions,
    })

    const titleCollector = createBoundedTextCollector()

    for await (const message of titleQuery) {
      if (abortController.signal.aborted || input.signal.aborted) {
        break
      }

      if (message.type === 'assistant') {
        const assistantMessage = (message as { message?: { content?: unknown } }).message
        const content = assistantMessage?.content
        if (Array.isArray(content)) {
          for (const block of content) {
            const textBlock = block as { type?: unknown, text?: unknown }
            if (textBlock.type === 'text' && typeof textBlock.text === 'string') {
              titleCollector.append(textBlock.text)
            }
          }
        }
      }

      if (message.type === 'result') {
        break
      }
    }

    const closeTitleQuery = (titleQuery as { close?: () => void }).close
    if (typeof closeTitleQuery === 'function') {
      closeTitleQuery.call(titleQuery)
    }
    const generatedTitle = titleCollector.read()?.trim() ?? ''
    if (generatedTitle.length === 0) {
      input.deps.logger?.warn('claude session title generation produced no assistant text', {
        modelId: input.modelId ?? null,
      })
      return null
    }
    if (generatedTitle.length > CLAUDE_SESSION_TITLE_MAX_LENGTH * 1.5) {
      input.deps.logger?.warn('claude session title generation exceeded length cap', {
        modelId: input.modelId ?? null,
        length: generatedTitle.length,
        cap: CLAUDE_SESSION_TITLE_MAX_LENGTH * 1.5,
        preview: generatedTitle.slice(0, 80),
      })
      return null
    }
    return generatedTitle
  }
  catch (error) {
    const enriched = stderrSink.enrichError(error)
    if (enriched instanceof ProviderRuntimeError && enriched.providerError._tag === 'auth_failed') {
      input.deps.logger?.warn('claude session title generation skipped: no api key resolved', {
        modelId: input.modelId ?? null,
        profileId: input.profile.id,
      })
      return null
    }
    input.deps.logger?.warn('claude session title generation failed', {
      err: enriched,
      modelId: input.modelId ?? null,
    })
    return null
  }
  finally {
    clearTimeout(timeout)
    input.signal.removeEventListener('abort', abortTitleRead)
  }
}

export function shouldGenerateClaudeSessionTitle(input: {
  providerSessionId: string | null
  promptText: string
}): boolean {
  return !input.providerSessionId
    && input.promptText.length > 0
}

export { CLAUDE_SESSION_TITLE_MAX_LENGTH, CLAUDE_SESSION_TITLE_PROMPT_PREFIX, CLAUDE_SESSION_TITLE_TIMEOUT_MS }
