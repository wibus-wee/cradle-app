import { E2E_ANTHROPIC_MODEL } from './scenarios/anthropic'
import { E2E_OPENAI_MODEL } from './scenarios/openai'

export const E2E_OPENAI_PROFILE_ID = 'e2e-openai-simulator'
export const E2E_ANTHROPIC_PROFILE_ID = 'e2e-anthropic-simulator'
export const E2E_TITLE_SINK_PROFILE_ID = 'e2e-title-sink'
export const E2E_OPENAI_AGENT_NAME = 'E2E Simulator'
export const E2E_CLAUDE_AGENT_NAME = 'E2E Claude Agent'

async function putJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function upsertOpenAiSimulatorProfile(input: {
  serverUrl: string
  openaiBaseUrl: string
  model?: string
}): Promise<void> {
  const model = input.model ?? E2E_OPENAI_MODEL
  const response = await putJson(`${input.serverUrl}/profiles/${E2E_OPENAI_PROFILE_ID}`, {
    name: E2E_OPENAI_AGENT_NAME,
    providerKind: 'openai-compatible',
    enabled: true,
    config: {
      baseUrl: input.openaiBaseUrl,
      model,
      apiMode: 'responses',
      apiKey: 'sk-e2e-simulator',
    },
    credentialRef: null,
  })
  if (!response.ok) {
    throw new Error(`Failed to upsert OpenAI simulator profile: ${response.status} ${await response.text()}`)
  }
}

export async function upsertAnthropicSimulatorProfile(input: {
  serverUrl: string
  anthropicBaseUrl: string
  model?: string
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
}): Promise<void> {
  const response = await putJson(`${input.serverUrl}/profiles/${E2E_ANTHROPIC_PROFILE_ID}`, {
    name: E2E_CLAUDE_AGENT_NAME,
    providerKind: 'anthropic',
    enabled: true,
    config: {
      authMode: 'apiKey',
      baseUrl: input.anthropicBaseUrl,
      model: input.model ?? E2E_ANTHROPIC_MODEL,
      permissionMode: input.permissionMode ?? 'default',
      apiKey: 'sk-ant-e2e-simulator',
    },
    credentialRef: null,
  })
  if (!response.ok) {
    throw new Error(`Failed to upsert Anthropic simulator profile: ${response.status} ${await response.text()}`)
  }
}

/**
 * Route Claude Agent title generation to a dead endpoint so it cannot steal
 * FIFO conversation exchanges from the shared simulator.
 */
export async function disableClaudeTitleGeneration(serverUrl: string): Promise<void> {
  const sink = await putJson(`${serverUrl}/profiles/${E2E_TITLE_SINK_PROFILE_ID}`, {
    name: 'E2E Title Sink',
    providerKind: 'anthropic',
    enabled: true,
    config: {
      authMode: 'apiKey',
      baseUrl: 'http://127.0.0.1:9',
      model: E2E_ANTHROPIC_MODEL,
      apiKey: 'sk-ant-title-sink',
    },
    credentialRef: null,
  })
  if (!sink.ok) {
    throw new Error(`Failed to upsert title sink profile: ${sink.status} ${await sink.text()}`)
  }

  const prefs = await putJson(`${serverUrl}/preferences/chat`, {
    modelId: null,
    configSelections: {},
    continuationBehavior: 'queue',
    titleGeneration: {
      providerTargetId: E2E_TITLE_SINK_PROFILE_ID,
      modelId: null,
      thinkingEffort: 'minimal',
    },
  })
  if (!prefs.ok) {
    throw new Error(`Failed to set chat preferences for title sink: ${prefs.status} ${await prefs.text()}`)
  }
}

export async function ensureAgentForProfile(input: {
  serverUrl: string
  name: string
  providerTargetId: string
  modelId: string
  runtimeKind: 'standard' | 'claude-agent'
}): Promise<void> {
  const listResponse = await fetch(`${input.serverUrl}/agents`)
  if (!listResponse.ok) {
    throw new Error(`Failed to list agents: ${listResponse.status} ${await listResponse.text()}`)
  }
  const agents = await listResponse.json() as Array<{
    name?: unknown
    providerTargetId?: unknown
  }>
  const exists = agents.some(
    agent => agent.name === input.name && agent.providerTargetId === input.providerTargetId,
  )
  if (exists) {
    return
  }

  const createResponse = await postJson(`${input.serverUrl}/agents`, {
    name: input.name,
    avatarStyle: 'dicebear',
    avatarSeed: input.name,
    providerTargetId: input.providerTargetId,
    modelId: input.modelId,
    runtimeKind: input.runtimeKind,
  })
  if (!createResponse.ok) {
    throw new Error(`Failed to create agent ${input.name}: ${createResponse.status} ${await createResponse.text()}`)
  }
}

export async function ensureWorkspace(input: {
  serverUrl: string
  createTempDir: () => string
}): Promise<string> {
  const listRes = await fetch(`${input.serverUrl}/workspaces`)
  if (listRes.ok) {
    const workspaces = await listRes.json() as Array<{ id?: string, path?: string }>
    if (workspaces.length > 0) {
      return workspaces[0]?.path ?? workspaces[0]?.id ?? 'existing'
    }
  }
  const dir = input.createTempDir()
  const res = await postJson(`${input.serverUrl}/workspaces/from-directory`, { path: dir })
  if (!res.ok) {
    throw new Error(`Failed to create workspace: ${res.status} ${await res.text()}`)
  }
  return dir
}

export async function configureStandardSimulatorProvider(input: {
  serverUrl: string
  openaiBaseUrl: string
  createTempDir: () => string
}): Promise<void> {
  await upsertOpenAiSimulatorProfile(input)
  await ensureAgentForProfile({
    serverUrl: input.serverUrl,
    name: E2E_OPENAI_AGENT_NAME,
    providerTargetId: E2E_OPENAI_PROFILE_ID,
    modelId: E2E_OPENAI_MODEL,
    runtimeKind: 'standard',
  })
  await ensureWorkspace(input)
}

export async function configureClaudeAgentSimulatorProvider(input: {
  serverUrl: string
  anthropicBaseUrl: string
  createTempDir: () => string
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
}): Promise<void> {
  await upsertAnthropicSimulatorProfile(input)
  await disableClaudeTitleGeneration(input.serverUrl)
  await ensureAgentForProfile({
    serverUrl: input.serverUrl,
    name: E2E_CLAUDE_AGENT_NAME,
    providerTargetId: E2E_ANTHROPIC_PROFILE_ID,
    modelId: E2E_ANTHROPIC_MODEL,
    runtimeKind: 'claude-agent',
  })
  await ensureWorkspace(input)
}
