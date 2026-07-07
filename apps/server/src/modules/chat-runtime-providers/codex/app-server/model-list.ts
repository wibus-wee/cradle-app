import type { ModelDescriptor } from '../../../provider-contracts/types'
import type { ModelListResponse } from '../app-server-protocol/v2/ModelListResponse'
import type { CodexAppServerClientLike } from '../types'
import type { CodexChatgptAuthCredential } from './chatgpt-auth'
import {
  buildCodexChatgptAuthLoginParams,
  ensureCodexChatgptAuthAccessToken,
} from './chatgpt-auth'
import type { CodexAppServerClientOptions } from './client'
import { CodexAppServerClient } from './client'

type ReasoningEffort = NonNullable<ModelDescriptor['capabilities']['reasoningEfforts']>[number]

let createClientForTests: ((options?: CodexAppServerClientOptions) => CodexAppServerClientLike) | null = null

export async function listCodexChatgptModels(input: {
  credential: CodexChatgptAuthCredential
  config?: Record<string, unknown>
  updateSecretValue?: (credentialRef: string, secret: string) => void
}): Promise<ModelDescriptor[]> {
  const clientOptions = input.config ? { config: input.config } : undefined
  const client = createClientForTests?.(clientOptions) ?? new CodexAppServerClient(clientOptions)
  try {
    await client.initialize()
    const credential = await ensureCodexChatgptAuthAccessToken(input.credential, {
      updateSecretValue: input.updateSecretValue,
    })
    await client.request('account/login/start', buildCodexChatgptAuthLoginParams(credential))
    const response = await client.request('model/list', {
      includeHidden: true,
      limit: 100,
    }) as ModelListResponse
    return projectCodexModelListResponse(response)
  }
  finally {
    await client.close()
  }
}

export async function listCodexApiKeyModels(input: {
  apiKey: string
  config?: Record<string, unknown>
}): Promise<ModelDescriptor[]> {
  const clientOptions = {
    ...(input.config ? { config: input.config } : {}),
    apiKey: input.apiKey,
  }
  const client = createClientForTests?.(clientOptions) ?? new CodexAppServerClient(clientOptions)
  try {
    await client.initialize()
    const response = await client.request('model/list', {
      includeHidden: true,
      limit: 100,
    }) as ModelListResponse
    return projectCodexModelListResponse(response)
  }
  finally {
    await client.close()
  }
}

export function setCodexChatgptModelListClientFactoryForTests(
  factory: ((options?: CodexAppServerClientOptions) => CodexAppServerClientLike) | null,
): void {
  createClientForTests = factory
}

function isModelDescriptorReasoningEffort(effort: string): effort is ReasoningEffort {
  return effort === 'none'
    || effort === 'minimal'
    || effort === 'low'
    || effort === 'medium'
    || effort === 'high'
    || effort === 'xhigh'
    || effort === 'max'
}

function projectCodexModelListResponse(response: ModelListResponse): ModelDescriptor[] {
  return response.data
    .map(model => ({
      id: model.id || model.model,
      label: model.displayName || model.id || model.model,
      providerKind: 'openai-compatible' as const,
      capabilities: {
        inputModalities: Array.isArray(model.inputModalities)
          ? model.inputModalities.map(modality => String(modality))
          : [],
        reasoning: Array.isArray(model.supportedReasoningEfforts) && model.supportedReasoningEfforts.length > 0,
        reasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
          ? model.supportedReasoningEfforts
              .map(option => option.reasoningEffort)
              .filter(isModelDescriptorReasoningEffort)
          : [],
      },
    }))
    .filter(model => model.id)
}
