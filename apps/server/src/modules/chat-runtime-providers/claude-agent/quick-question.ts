import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessageChunk } from 'ai'

import type { GetCapabilitiesInput, QuickQuestionInput } from '../../chat-runtime/runtime-provider-types'
import { requireRuntimeProviderTargetProfile } from '../../chat-runtime/runtime-provider-types'
import { readTrustedClaudeAgentConfig } from '../../provider-contracts/provider-base'
import { readWorkspaceProviderStateSnapshot } from '../kit/state-snapshot'
import { ClaudeAgentInputStream } from './async-input-stream'
import {
  createClaudeAgentChunkMapperState,
  mapClaudeAgentMessageToChunks,
} from './event-to-chunk-mapper'
import {
  buildClaudeAgentTurnContent,
  buildClaudeQueryOptions,
  createClaudeStderrSink,
  projectClaudeAgentInput,
} from './input-projector'
import type { ClaudeAgentProviderDeps } from './types'

export async function* streamClaudeAgentQuickQuestion(
  input: QuickQuestionInput,
  deps: ClaudeAgentProviderDeps,
): AsyncGenerator<UIMessageChunk, void, void> {
  const abortController = new AbortController()
  const profile = requireRuntimeProviderTargetProfile(input.profile, 'claude-agent')
  const config = readTrustedClaudeAgentConfig(profile.configJson)
  const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
  const effectiveModel = snapshot.models.currentModelId ?? config.model
  const stderrSink = createClaudeStderrSink()
  const queryOptions = buildClaudeQueryOptions({
    deps,
    input: {
      runtimeSession: input.runtimeSession,
      profile,
      workspacePath: input.workspacePath,
      workspaceId: input.workspaceId,
      modelId: effectiveModel,
    } as GetCapabilitiesInput,
    abortController,
    attachPermissionHandler: false,
    persistSession: false,
    onStderr: stderrSink.onStderr,
  })

  queryOptions.tools = []
  delete queryOptions.mcpServers
  delete queryOptions.skills

  const inputStream = new ClaudeAgentInputStream()
  const activeQuery = query({ prompt: inputStream, options: queryOptions })
  const mapperState = createClaudeAgentChunkMapperState()

  try {
    inputStream.push(buildClaudeAgentTurnContent({
      userContent: projectClaudeAgentInput(input.question, 'QuickQuestion'),
      history: input.transcript,
    }))

    for await (const message of activeQuery) {
      if (abortController.signal.aborted) { break }
      const result = await mapClaudeAgentMessageToChunks(message, mapperState)
      for (const chunk of result.chunks) { yield chunk }
      if (message.type === 'result') { break }
    }
  }
  catch (error) {
    throw stderrSink.enrichError(error)
  }
  finally {
    abortController.abort()
    closeClaudeQuery(activeQuery)
  }
}

function closeClaudeQuery(activeQuery: Query): void {
  const close = (activeQuery as { close?: unknown }).close
  if (typeof close === 'function') { close.call(activeQuery) }
}
