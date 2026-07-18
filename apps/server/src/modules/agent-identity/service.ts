import { randomUUID } from 'node:crypto'

import type { Agent } from '@cradle/db'
import { agents } from '@cradle/db'
import type { SQL } from 'drizzle-orm'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { AgentRuntimeConfigJsonSchema } from '../../helpers/agent-runtime-config'
import { db } from '../../infra'
import { createLocalAgentConfigExternalProviderSource } from '../external-provider-sources/local-agent-config-source'
import {
  getExternalRuntimeTarget,
  listExternalProviderRecords,
  listExternalProviderSources,
  refreshDirectExternalProviderSource,
  refreshExternalProviderSource,
} from '../external-provider-sources/service'
import {
  runtimeSkipsProviderTarget,
  runtimeUsesAgentTerminalLaunch,
} from '../provider-contracts/runtime-compatibility'
import type { RuntimeKind } from '../provider-contracts/types'
import {
  assertProviderTargetCompatibleWithRuntime,
  getProviderTarget,
} from '../provider-targets/service'
import { buildAgentAvatarUrl } from './avatar'

export interface AgentListFilters {
  enabled?: boolean
  providerTargetId?: string
}

export interface CreateAgentInput {
  name: string
  description?: string | null
  avatarStyle: string
  avatarSeed: string
  providerTargetId?: string | null
  modelId?: string | null
  thinkingEffort?: AgentThinkingEffort
  runtimeKind?: RuntimeKind
  configJson?: string
}

export interface UpdateAgentInput {
  name?: string
  description?: string | null
  avatarStyle?: string
  avatarSeed?: string
  providerTargetId?: string | null
  modelId?: string | null
  thinkingEffort?: AgentThinkingEffort
  runtimeKind?: RuntimeKind
  configJson?: string
  enabled?: boolean
}

export interface ImportLocalConfigInput {
  includeProcessEnv?: boolean
  candidateIds?: string[]
}

export interface LocalConfigImportCandidate {
  id: string
  app: 'claude' | 'codex' | 'gemini' | 'pi' | 'kimi'
  runtimeKind: 'claude-agent' | 'codex' | 'cli-tui'
  sourceKind: 'cc-switch' | 'local-config'
  sourceLabel: string
  externalRecordId: string
  providerTargetId: string | null
  agentName: string
  resolvedProviderName: string
  name: string
  modelId: string | null
  endpoint: string | null
  executable: string | null
  iconSlug: string | null
  avatarUrl: string | null
  importable: boolean
  alreadyConfigured: boolean
  reason: string | null
  notes: string[]
  agent: Agent | null
}

export interface PreviewLocalConfigImportResult {
  candidates: LocalConfigImportCandidate[]
  sourceRefreshes: Array<{
    sourceKey: string
    sourceLabel: string
    status: 'ok' | 'warning' | 'error'
    recordsSeen: number
    recordsProjected: number
    recordsMissing: number
    message: string | null
  }>
}

export interface ImportedAgentResult {
  app: 'claude' | 'codex' | 'gemini' | 'pi' | 'kimi'
  candidateId: string
  sourceKind: 'cc-switch' | 'local-config'
  externalRecordId: string
  providerTargetId: string | null
  runtimeKind: 'claude-agent' | 'codex' | 'cli-tui'
  status: 'created' | 'existing' | 'skipped'
  reason: string | null
  agent: Agent | null
}

export interface ImportLocalConfigResult {
  preview: PreviewLocalConfigImportResult
  created: number
  existing: number
  skipped: number
  agents: ImportedAgentResult[]
}

const AgentRuntimeKindSchema = z.string().trim().min(1)
const AgentThinkingEffortSchema = z.enum([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
])
export type AgentThinkingEffort = z.infer<typeof AgentThinkingEffortSchema>

function normalizeAgentThinkingEffort(effort: unknown): AgentThinkingEffort {
  return AgentThinkingEffortSchema.safeParse(effort).data ?? 'high'
}
const ImportLocalConfigInputSchema = z
  .object({
    includeProcessEnv: z.boolean().optional(),
    candidateIds: z.array(z.string().trim().min(1)).optional(),
  })
  .default({})
const AgentDescriptionSchema = z
  .string()
  .trim()
  .transform(value => (value.length > 0 ? value : null))
  .nullable()
  .default(null)
const DefaultAgentRuntimeConfig = AgentRuntimeConfigJsonSchema.parse(undefined)

const CreateAgentInputSchema = z
  .object({
    name: z.string().trim().min(1),
    description: AgentDescriptionSchema,
    avatarStyle: z.string().min(1),
    avatarSeed: z.string().min(1),
    providerTargetId: z.string().trim().min(1).nullable().default(null),
    modelId: z.string().trim().min(1).nullable().default(null),
    thinkingEffort: AgentThinkingEffortSchema.default('high'),
    runtimeKind: AgentRuntimeKindSchema.default('standard'),
    configJson: AgentRuntimeConfigJsonSchema.default(DefaultAgentRuntimeConfig),
  })
  .superRefine((input, ctx) => {
    if (runtimeUsesAgentTerminalLaunch(input.runtimeKind)) {
      if (input.providerTargetId) {
        ctx.addIssue({
          code: 'custom',
          message: 'Agent terminal runtimes must not reference a provider target',
          path: ['providerTargetId'],
        })
        return
      }

      if (!input.configJson.cliTui) {
        ctx.addIssue({
          code: 'custom',
          message: 'Agent terminal runtimes require launch configuration',
          path: ['configJson'],
        })
      }
      return
    }

    if (!input.providerTargetId) {
      if (!runtimeSkipsProviderTarget(input.runtimeKind)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Provider-backed agents require a provider target',
          path: ['providerTargetId'],
        })
      }
      return
    }

    try {
      assertProviderTargetCompatibleWithRuntime(input.providerTargetId, input.runtimeKind)
    }
 catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid provider target',
        path: ['providerTargetId'],
      })
    }
  })
  .transform((input) => {
    const parsed = {
      ...input,
      configJson: JSON.stringify(input.configJson),
    }
    return runtimeUsesAgentTerminalLaunch(input.runtimeKind)
      ? {
          ...parsed,
          providerTargetId: null,
          modelId: null,
          thinkingEffort: 'high' as const,
        }
      : parsed
  })

type ParsedAgentInput = z.infer<typeof CreateAgentInputSchema>

function canRunAgent(input: {
  runtimeKind: ParsedAgentInput['runtimeKind']
  providerTargetId: string | null
}): boolean {
  if (runtimeUsesAgentTerminalLaunch(input.runtimeKind) || runtimeSkipsProviderTarget(input.runtimeKind)) {
    return true
  }
  if (!input.providerTargetId) {
    return false
  }
  return getProviderTarget(input.providerTargetId)?.enabled ?? false
}

function normalizeAgentEnabled(input: {
  requestedEnabled: boolean
  runtimeKind: ParsedAgentInput['runtimeKind']
  providerTargetId: string | null
}): boolean {
  return input.requestedEnabled && canRunAgent(input)
}

export function list(filters: AgentListFilters = {}): Agent[] {
  const clauses: SQL[] = []
  if (filters.enabled !== undefined) {
    clauses.push(eq(agents.enabled, filters.enabled))
  }
  if (filters.providerTargetId) {
    clauses.push(eq(agents.providerTargetId, filters.providerTargetId))
  }

  const query = db().select().from(agents)
  if (clauses.length === 0) {
    return query.orderBy(desc(agents.updatedAt)).all()
  }
  return query
    .where(clauses.length === 1 ? clauses[0]! : and(...clauses))
    .orderBy(desc(agents.updatedAt))
    .all()
}

export function get(id: string): Agent | null {
  return db().select().from(agents).where(eq(agents.id, id)).get() ?? null
}

export function create(input: CreateAgentInput): Agent {
  let parsed: ParsedAgentInput | null = null
  try {
    parsed = CreateAgentInputSchema.parse(input)
    const avatarUrl = buildAgentAvatarUrl(parsed.avatarStyle, parsed.avatarSeed)
    return db()
      .insert(agents)
      .values({
        id: randomUUID(),
        name: parsed.name,
        description: parsed.description,
        avatarUrl,
        avatarStyle: parsed.avatarStyle,
        avatarSeed: parsed.avatarSeed,
        providerTargetId: parsed.providerTargetId,
        modelId: parsed.modelId,
        thinkingEffort: parsed.thinkingEffort,
        runtimeKind: parsed.runtimeKind,
        configJson: parsed.configJson,
        enabled: normalizeAgentEnabled({
          requestedEnabled: true,
          runtimeKind: parsed.runtimeKind,
          providerTargetId: parsed.providerTargetId,
        }),
      })
      .returning()
      .get()
  }
 catch (error) {
    throw mapAgentIdentityError(error, parsed?.providerTargetId)
  }
}

const LOCAL_AGENT_CONFIG_SOURCE_OWNER = 'cradle-onboarding'

function localAgentApp(app: string): LocalConfigImportCandidate['app'] | null {
  if (app === 'claude') {
    return 'claude'
  }
  if (app === 'codex') {
    return 'codex'
  }
  if (app === 'gemini') {
    return 'gemini'
  }
  if (app === 'pi') {
    return 'pi'
  }
  if (app === 'kimi') {
    return 'kimi'
  }
  return null
}

function runtimeKindForLocalApp(
  app: LocalConfigImportCandidate['app'],
  metadata: Record<string, unknown> = {},
): LocalConfigImportCandidate['runtimeKind'] {
  if (metadataString(metadata, 'runtimeKind') === 'cli-tui') {
    return 'cli-tui'
  }
  if (app === 'claude') {
    return 'claude-agent'
  }
  if (app === 'codex') {
    return 'codex'
  }
  return 'cli-tui'
}

function agentNameForLocalApp(app: ImportedAgentResult['app']): string {
  switch (app) {
    case 'claude':
      return 'Local Claude'
    case 'codex':
      return 'Local Codex'
    case 'gemini':
      return 'Local Gemini'
    case 'pi':
      return 'Local Pi'
    case 'kimi':
      return 'Local Kimi'
  }
}

function agentNameForLocalImport(
  app: ImportedAgentResult['app'],
  runtimeKind: ImportedAgentResult['runtimeKind'],
): string {
  if (
    runtimeUsesAgentTerminalLaunch(runtimeKind)
    && (app === 'claude' || app === 'codex' || app === 'gemini')
  ) {
    return `${agentNameForLocalApp(app)} CLI`
  }
  return agentNameForLocalApp(app)
}

function importedAgentDescription(
  app: ImportedAgentResult['app'],
  runtimeKind: ImportedAgentResult['runtimeKind'],
): string {
  if (runtimeUsesAgentTerminalLaunch(runtimeKind)) {
    switch (app) {
      case 'claude':
        return 'Imported from local Claude CLI.'
      case 'codex':
        return 'Imported from local Codex CLI.'
      case 'gemini':
        return 'Imported from local Gemini CLI.'
      case 'pi':
        return 'Imported from local Pi CLI.'
      case 'kimi':
        return 'Imported from local Kimi CLI.'
    }
  }
  switch (app) {
    case 'claude':
      return 'Imported from local Claude configuration.'
    case 'codex':
      return 'Imported from local Codex configuration.'
    case 'gemini':
      return 'Imported from local Gemini CLI.'
    case 'pi':
      return 'Imported from local Pi CLI.'
    case 'kimi':
      return 'Imported from local Kimi CLI.'
  }
}

function importedAgentAvatar(candidate: LocalConfigImportCandidate): {
  avatarStyle: string
  avatarSeed: string
} {
  if (candidate.avatarUrl) {
    return {
      avatarStyle: 'external-url',
      avatarSeed: candidate.avatarUrl,
    }
  }
  if (candidate.iconSlug) {
    return {
      avatarStyle: 'lobehub-icon',
      avatarSeed: candidate.iconSlug,
    }
  }
  return {
    avatarStyle: 'bottts-neutral',
    avatarSeed: `${candidate.sourceKind}:${candidate.app}`,
  }
}

function agentConfigObject(agent: Agent): Record<string, unknown> {
  try {
    return AgentRuntimeConfigJsonSchema.parse(agent.configJson)
  }
 catch {
    return {}
  }
}

function findAgentForLocalImport(
  app: ImportedAgentResult['app'],
  runtimeKind: ImportedAgentResult['runtimeKind'],
): Agent | null {
  const agentName = agentNameForLocalImport(app, runtimeKind)
  const markedAgent = db()
    .select()
    .from(agents)
    .where(eq(agents.runtimeKind, runtimeKind))
    .all()
    .find((agent) => {
      const onboarding = agentConfigObject(agent).cradleOnboarding
      return Boolean(
        onboarding
        && typeof onboarding === 'object'
        && (onboarding as Record<string, unknown>).localApp === app,
      )
    })
  if (markedAgent) {
    return markedAgent
  }

  return (
    db()
      .select()
      .from(agents)
      .where(and(eq(agents.name, agentName), eq(agents.runtimeKind, runtimeKind)))
      .get() ?? null
  )
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function localProxyUrl(value: string | null): boolean {
  if (!value) {
    return false
  }
  try {
    const url = new URL(value)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  }
 catch {
    return false
  }
}

function absoluteAvatarUrl(value: string | null): string | null {
  if (!value) {
    return null
  }
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'data:'
      ? value
      : null
  }
 catch {
    return null
  }
}

function metadataIconSlug(metadata: Record<string, unknown>): string | null {
  const iconSlug = metadataString(metadata, 'iconSlug')
  if (iconSlug) {
    return iconSlug
  }
  const iconUrl = metadataString(metadata, 'iconUrl')
  return iconUrl && !absoluteAvatarUrl(iconUrl) ? iconUrl : null
}

function metadataAvatarUrl(metadata: Record<string, unknown>): string | null {
  return (
    absoluteAvatarUrl(metadataString(metadata, 'avatarUrl'))
    ?? absoluteAvatarUrl(metadataString(metadata, 'iconUrl'))
  )
}

async function refreshOnboardingSources(
  input: ImportLocalConfigInput,
): Promise<PreviewLocalConfigImportResult['sourceRefreshes']> {
  const parsed = ImportLocalConfigInputSchema.parse(input)
  const sharedConfig = new Map<string, string>()
  if (parsed.includeProcessEnv !== undefined) {
    sharedConfig.set(
      'LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV',
      parsed.includeProcessEnv ? 'true' : 'false',
    )
  }

  const localRefresh = await refreshDirectExternalProviderSource({
    owner: LOCAL_AGENT_CONFIG_SOURCE_OWNER,
    source: createLocalAgentConfigExternalProviderSource(),
    sharedConfig,
  })

  const refreshes: PreviewLocalConfigImportResult['sourceRefreshes'] = [
    {
      sourceKey: localRefresh.sourceKey,
      sourceLabel: 'Local Agent Config',
      status: localRefresh.status,
      recordsSeen: localRefresh.recordsSeen,
      recordsProjected: localRefresh.recordsProjected,
      recordsMissing: localRefresh.recordsMissing,
      message: localRefresh.message ?? null,
    },
  ]

  for (const source of listExternalProviderSources().filter(
    source => source.sourceId === 'cc-switch',
  )) {
    const refresh = await refreshExternalProviderSource(source.id)
    refreshes.push({
      sourceKey: refresh.sourceKey,
      sourceLabel: source.label,
      status: refresh.status,
      recordsSeen: refresh.recordsSeen,
      recordsProjected: refresh.recordsProjected,
      recordsMissing: refresh.recordsMissing,
      message: refresh.message ?? null,
    })
  }

  return refreshes
}

function candidateFromRecord(input: {
  sourceKind: LocalConfigImportCandidate['sourceKind']
  sourceLabel: string
  sourceKey: string
  app: LocalConfigImportCandidate['app']
  externalRecordId: string
  name: string
  metadata: Record<string, unknown>
  providerTargetId: string | null
  reason: string | null
  notes: string[]
}): LocalConfigImportCandidate {
  const runtimeKind = runtimeKindForLocalApp(input.app, input.metadata)
  const agent = findAgentForLocalImport(input.app, runtimeKind)
  const needsProviderTarget = !runtimeUsesAgentTerminalLaunch(runtimeKind)
  const importable = (needsProviderTarget ? Boolean(input.providerTargetId) : true) && !input.reason
  const agentName = agentNameForLocalImport(input.app, runtimeKind)
  return {
    id: `${input.sourceKind}:${input.app}:${input.sourceKey}:${input.externalRecordId}`,
    app: input.app,
    runtimeKind,
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel,
    externalRecordId: input.externalRecordId,
    providerTargetId: input.providerTargetId,
    agentName,
    resolvedProviderName: input.name,
    name: agentName,
    modelId: metadataString(input.metadata, 'model'),
    endpoint: metadataString(input.metadata, 'baseUrl'),
    executable: metadataString(input.metadata, 'executable'),
    iconSlug: metadataIconSlug(input.metadata),
    avatarUrl: metadataAvatarUrl(input.metadata),
    importable,
    alreadyConfigured: Boolean(agent),
    reason: input.reason,
    notes: input.notes,
    agent,
  }
}

export async function previewLocalConfigImport(
  input: ImportLocalConfigInput = {},
): Promise<PreviewLocalConfigImportResult> {
  const sourceRefreshes = await refreshOnboardingSources(input)
  const localSourceKey = sourceRefreshes[0]?.sourceKey ?? null
  const ccSwitchSourceKeys = new Set(
    listExternalProviderSources()
      .filter(source => source.sourceId === 'cc-switch')
      .map(source => source.id),
  )
  const allRecords = listExternalProviderRecords()
  const localRecords = allRecords
    .filter(record => record.sourceKey === localSourceKey)
    .filter(record => record.status === 'active')
    .filter(
      record =>
        record.app === 'claude'
        || record.app === 'codex'
        || record.app === 'gemini'
        || record.app === 'pi'
        || record.app === 'kimi',
    )
  const ccSwitchCurrentRecords = listExternalProviderRecords()
    .filter(record => record.status === 'active')
    .filter(record => ccSwitchSourceKeys.has(record.sourceKey))
    .filter(
      record => record.app === 'claude' || record.app === 'codex' || record.app === 'gemini',
    )
    .filter(record => record.metadata.current === true)

  const localProxyApps = new Set(
    localRecords
      .filter(record => localProxyUrl(metadataString(record.metadata, 'baseUrl')))
      .map(record => record.app),
  )
  const candidates: LocalConfigImportCandidate[] = []

  for (const record of ccSwitchCurrentRecords) {
    const app = localAgentApp(record.app)
    if (!app || !localProxyApps.has(app)) {
      continue
    }
    const target = getExternalRuntimeTarget(record.sourceKey, record.externalId)
    const agentName = agentNameForLocalImport(app, runtimeKindForLocalApp(app, record.metadata))
    candidates.push(
      candidateFromRecord({
        sourceKind: 'cc-switch',
        sourceLabel: 'CC Switch',
        sourceKey: record.sourceKey,
        app,
        externalRecordId: record.externalId,
        name: record.name,
        metadata: record.metadata,
        providerTargetId: target?.id ?? record.providerTargetId,
        reason: target ? null : 'No runtime target was projected for this CC Switch provider.',
        notes: [
          `Detected ${app} local config using the CC Switch local proxy; Cradle will import ${agentName} with the resolved CC Switch upstream provider "${record.name}".`,
        ],
      }),
    )
  }

  const ccSwitchApps = new Set(candidates.map(candidate => candidate.app))
  for (const record of localRecords) {
    const app = localAgentApp(record.app)
    const localProxyRecordSupersededByCcSwitch
      = app
        && record.providerKind !== 'cli-tool'
        && localProxyUrl(metadataString(record.metadata, 'baseUrl'))
        && ccSwitchApps.has(app)
    if (!app || localProxyRecordSupersededByCcSwitch) {
      continue
    }
    const target = getExternalRuntimeTarget(record.sourceKey, record.externalId)
    const agentName = agentNameForLocalImport(app, runtimeKindForLocalApp(app, record.metadata))
    candidates.push(
      candidateFromRecord({
        sourceKind: 'local-config',
        sourceLabel: 'Local Agent Config',
        sourceKey: record.sourceKey,
        app,
        externalRecordId: record.externalId,
        name: record.name,
        metadata: record.metadata,
        providerTargetId: target?.id ?? record.providerTargetId,
        reason:
          record.providerKind === 'cli-tool' || target
            ? null
            : 'No runtime target was projected for this local provider record.',
        notes: localProxyUrl(metadataString(record.metadata, 'baseUrl'))
          ? [
              'Detected a local proxy endpoint, but no matching CC Switch current provider target is available.',
            ]
          : [`Detected direct local ${agentName} configuration.`],
      }),
    )
  }

  return { candidates, sourceRefreshes }
}

function compactRuntimeConfig(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function providerTargetConnectionConfig(providerTargetId: string): Record<string, unknown> {
  const target = getProviderTarget(providerTargetId)
  if (!target) {
    return {}
  }

  try {
    return z.record(z.string(), z.unknown()).parse(JSON.parse(target.connectionConfigJson))
  }
 catch {
    return {}
  }
}

function buildAgentRuntimeConfig(candidate: LocalConfigImportCandidate): string {
  const targetConfig = candidate.providerTargetId
    ? providerTargetConnectionConfig(candidate.providerTargetId)
    : {}
  const common = {
    cradleOnboarding: {
      localApp: candidate.app,
      sourceKind: candidate.sourceKind,
      externalRecordId: candidate.externalRecordId,
      resolvedProviderName: candidate.resolvedProviderName,
    },
  }

  if (runtimeUsesAgentTerminalLaunch(candidate.runtimeKind)) {
    const executable
      = targetConfig.executable ?? candidate.executable ?? candidate.endpoint ?? candidate.app
    return JSON.stringify(
      compactRuntimeConfig({
        ...common,
        cliTui: {
          executable,
          args: [],
        },
      }),
    )
  }

  const claudeAgentConfig = targetConfig.claudeAgent
  return JSON.stringify(
    compactRuntimeConfig({
      ...common,
      model: candidate.modelId ?? targetConfig.model,
      claudeAgent:
        claudeAgentConfig && typeof claudeAgentConfig === 'object' ? claudeAgentConfig : undefined,
      reasoningEffort: targetConfig.reasoningEffort,
      approvalPolicy: targetConfig.approvalPolicy,
      sandboxMode: targetConfig.sandboxMode,
    }),
  )
}

function readImportedAgentThinkingEffort(
  candidate: LocalConfigImportCandidate,
  fallback: AgentThinkingEffort,
): AgentThinkingEffort {
  if (!candidate.providerTargetId) {
    return fallback
  }
  const configured = providerTargetConnectionConfig(candidate.providerTargetId).reasoningEffort
  return AgentThinkingEffortSchema.safeParse(configured).data ?? fallback
}

export async function importLocalConfig(
  input: ImportLocalConfigInput = {},
): Promise<ImportLocalConfigResult> {
  const parsed = ImportLocalConfigInputSchema.parse(input)
  const preview = await previewLocalConfigImport(parsed)
  const selectedIds = new Set(
    parsed.candidateIds
    ?? preview.candidates
        .filter(candidate => candidate.importable)
        .map(candidate => candidate.id),
  )
  const results: ImportedAgentResult[] = []

  for (const candidate of preview.candidates.filter(candidate => selectedIds.has(candidate.id))) {
    const needsProviderTarget = !runtimeUsesAgentTerminalLaunch(candidate.runtimeKind)
    if ((needsProviderTarget && !candidate.providerTargetId) || !candidate.importable) {
      results.push({
        app: candidate.app,
        candidateId: candidate.id,
        sourceKind: candidate.sourceKind,
        externalRecordId: candidate.externalRecordId,
        providerTargetId: candidate.providerTargetId,
        runtimeKind: candidate.runtimeKind,
        status: 'skipped',
        reason: candidate.reason ?? 'Candidate is not importable.',
        agent: null,
      })
      continue
    }

    if (candidate.agent) {
      const updatedAgent
        = update(candidate.agent.id, {
          name: candidate.agentName,
          description: importedAgentDescription(candidate.app, candidate.runtimeKind),
          avatarStyle: candidate.agent.avatarStyle,
          avatarSeed: candidate.agent.avatarSeed,
          providerTargetId: candidate.providerTargetId,
          modelId: candidate.modelId,
          thinkingEffort: readImportedAgentThinkingEffort(
            candidate,
            normalizeAgentThinkingEffort(candidate.agent.thinkingEffort),
          ),
          runtimeKind: candidate.runtimeKind,
          configJson: buildAgentRuntimeConfig(candidate),
        }) ?? candidate.agent
      results.push({
        app: candidate.app,
        candidateId: candidate.id,
        sourceKind: candidate.sourceKind,
        externalRecordId: candidate.externalRecordId,
        providerTargetId: candidate.providerTargetId,
        runtimeKind: candidate.runtimeKind,
        status: 'existing',
        reason: null,
        agent: updatedAgent,
      })
      continue
    }

    const avatar = importedAgentAvatar(candidate)
    const createdAgent = create({
      name: candidate.agentName,
      description: importedAgentDescription(candidate.app, candidate.runtimeKind),
      avatarStyle: avatar.avatarStyle,
      avatarSeed: avatar.avatarSeed,
      providerTargetId: candidate.providerTargetId,
      modelId: candidate.modelId,
      thinkingEffort: readImportedAgentThinkingEffort(candidate, 'high'),
      runtimeKind: candidate.runtimeKind,
      configJson: buildAgentRuntimeConfig(candidate),
    })
    results.push({
      app: candidate.app,
      candidateId: candidate.id,
      sourceKind: candidate.sourceKind,
      externalRecordId: candidate.externalRecordId,
      providerTargetId: candidate.providerTargetId,
      runtimeKind: candidate.runtimeKind,
      status: 'created',
      reason: null,
      agent: createdAgent,
    })
  }

  return {
    preview,
    created: results.filter(result => result.status === 'created').length,
    existing: results.filter(result => result.status === 'existing').length,
    skipped: results.filter(result => result.status === 'skipped').length,
    agents: results,
  }
}

export function update(id: string, patch: UpdateAgentInput): Agent | null {
  const current = db().select().from(agents).where(eq(agents.id, id)).get()
  if (!current) {
    return null
  }

  let parsed: ParsedAgentInput | null = null

  try {
    parsed = CreateAgentInputSchema.parse({
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      avatarStyle: patch.avatarStyle ?? current.avatarStyle,
      avatarSeed: patch.avatarSeed ?? current.avatarSeed,
      providerTargetId: patch.providerTargetId ?? current.providerTargetId,
      modelId: patch.modelId ?? current.modelId,
      thinkingEffort: patch.thinkingEffort ?? normalizeAgentThinkingEffort(current.thinkingEffort),
      runtimeKind: patch.runtimeKind ?? current.runtimeKind,
      configJson: patch.configJson ?? current.configJson,
    })

    const updatePatch: Record<string, unknown> = { updatedAt: Math.floor(Date.now() / 1000) }

    if (patch.name !== undefined) {
      updatePatch.name = parsed.name
    }
    if (patch.description !== undefined) {
      updatePatch.description = parsed.description
    }
    if (patch.avatarStyle !== undefined) {
      updatePatch.avatarStyle = parsed.avatarStyle
    }
    if (patch.avatarSeed !== undefined) {
      updatePatch.avatarSeed = parsed.avatarSeed
    }
    if (patch.providerTargetId !== undefined) {
      updatePatch.providerTargetId = parsed.providerTargetId
    }
    if (patch.modelId !== undefined) {
      updatePatch.modelId = parsed.modelId
    }
    if (patch.thinkingEffort !== undefined) {
      updatePatch.thinkingEffort = parsed.thinkingEffort
    }
    if (patch.runtimeKind !== undefined) {
      updatePatch.runtimeKind = parsed.runtimeKind
    }
    if (patch.configJson !== undefined) {
      updatePatch.configJson = parsed.configJson
    }
    if (
      patch.enabled !== undefined
      || patch.providerTargetId !== undefined
      || patch.runtimeKind !== undefined
    ) {
      updatePatch.enabled = normalizeAgentEnabled({
        requestedEnabled: patch.enabled ?? current.enabled,
        runtimeKind: parsed.runtimeKind,
        providerTargetId: parsed.providerTargetId,
      })
    }
    if (patch.avatarStyle !== undefined || patch.avatarSeed !== undefined) {
      updatePatch.avatarUrl = buildAgentAvatarUrl(parsed.avatarStyle, parsed.avatarSeed)
    }

    return db().update(agents).set(updatePatch).where(eq(agents.id, id)).returning().get() ?? null
  }
 catch (error) {
    throw mapAgentIdentityError(error, parsed?.providerTargetId)
  }
}

export function remove(id: string): void {
  db().delete(agents).where(eq(agents.id, id)).run()
}

function mapAgentIdentityError(error: unknown, providerTargetId: string | null | undefined): Error {
  if (error instanceof z.ZodError) {
    return new AppError({
      code: 'invalid_agent_input',
      status: 400,
      message: error.issues[0]?.message ?? 'Invalid agent input',
      details: { issues: error.issues },
    })
  }

  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('FOREIGN KEY constraint failed') && providerTargetId) {
    return new AppError({
      code: 'provider_target_not_found',
      status: 400,
      message: 'Provider target not found',
      details: { providerTargetId },
    })
  }
  return error instanceof Error ? error : new Error(message)
}
