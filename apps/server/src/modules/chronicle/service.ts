import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import {
  chronicleAccessibilityEvents,
  chronicleAccessibilitySnapshots,
  chronicleActivitySegments,
  chronicleActivitySessions,
  chronicleAudioRawSegments,
  chronicleAudioSegments,
  chronicleAudioTranscripts,
  chronicleDreamCandidates,
  chronicleDreamRuns,
  chronicleEvents,
  chronicleKnowledgeCards,
  chronicleKnowledgeFiles,
  chronicleKnowledgeSources,
  chronicleKnowledgeVersions,
  chronicleMemories,
  chronicleMemoryChunks,
  chronicleMemoryEmbeddings,
  chronicleMemoryKeywords,
  chronicleMessages,
  chronicleMessageSources,
  chronicleModelResources,
  chroniclePipelineRuns,
  chronicleSnapshots,
  chronicleSpeakerProfiles,
} from '@cradle/db'
import type { LanguageModel } from 'ai'
import { generateText } from 'ai'
import { count, desc, eq, inArray, sql } from 'drizzle-orm'
import formatDuration from 'format-duration'
import sharp from 'sharp'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db, getServerConfig } from '../../infra'
import { createLanguageModel, detectApiFormat } from '../chat-runtime-engine/providers'
import * as ProviderTargets from '../provider-targets/service'
import { readSecret } from '../secrets/service'
import * as DaemonManager from './daemon-manager'

interface ChronicleConfig {
  profileId: string
  modelId: string
  workspaceId: string
  enabled: boolean
  activityPipelineEnabled: boolean
  activityPipelineIntervalMs: number
  activityPipelineBatchSize: number
  dreamSchedulerEnabled: boolean
  dreamSchedulerIntervalMs: number
  dreamSchedulerApplyMerge: boolean
  audioCaptureEnabled: boolean
  audioSource: 'microphone' | 'system' | 'mixed'
  audioSegmentMs: number
  audioSegmentIntervalMs: number
  audioRmsThreshold: number
  storageRoot: string
  privacySensitiveAppBundleIds: string[]
  privacySensitiveTitlePatterns: string[]
  privacySensitiveUrlPatterns: string[]
  closedEyesDiscardEnabled: boolean
  closedEyesMode: 'auto' | 'always-record' | 'always-pause'
}

const defaultConfig: ChronicleConfig = {
  profileId: '',
  modelId: '',
  workspaceId: '',
  enabled: false,
  activityPipelineEnabled: false,
  activityPipelineIntervalMs: 120_000,
  activityPipelineBatchSize: 3,
  dreamSchedulerEnabled: false,
  dreamSchedulerIntervalMs: 86_400_000,
  dreamSchedulerApplyMerge: false,
  audioCaptureEnabled: false,
  audioSource: 'microphone',
  audioSegmentMs: 5_000,
  audioSegmentIntervalMs: 60_000,
  audioRmsThreshold: 0.02,
  storageRoot: resolve(homedir(), '.cradle', 'chronicle'),
  privacySensitiveAppBundleIds: [],
  privacySensitiveTitlePatterns: [],
  privacySensitiveUrlPatterns: [],
  closedEyesDiscardEnabled: false,
  closedEyesMode: 'auto',
}

const CLOSED_EYES_DISCARD_RUNTIME_ENABLED = false
const CHRONICLE_PRODUCTION_DISABLED_MESSAGE = 'Chronicle runtime is only available in development builds.'
const CHRONICLE_MODEL_GENERATE_DEFAULT_MAX_ATTEMPTS = 3
const CHRONICLE_MODEL_GENERATE_DEFAULT_BASE_DELAY_MS = 750
const CHRONICLE_MODEL_GENERATE_MAX_DELAY_MS = 5_000
const CHRONICLE_MODEL_GENERATE_TIMEOUT_MS = 120_000

type ChronicleGenerateTextResult = Awaited<ReturnType<typeof generateText>>
type ChronicleGenerateStage = 'summarize' | 'triage' | 'summarization' | 'crystallization'

const ChronicleModelGenerateMaxAttemptsSchema = z.coerce.number()
  .int()
  .min(1)
  .max(8)
  .default(CHRONICLE_MODEL_GENERATE_DEFAULT_MAX_ATTEMPTS)

const ChronicleModelGenerateBaseDelayMsSchema = z.coerce.number()
  .int()
  .nonnegative()
  .max(60_000)
  .default(CHRONICLE_MODEL_GENERATE_DEFAULT_BASE_DELAY_MS)

const ChroniclePrivacyRuleListSchema = z.array(z.string())
  .default([])
  .transform(values => Array.from(new Set(values.map(value => value.trim()).filter(Boolean))))

const ChronicleConfigSchema = z.object({
  profileId: z.string().default(defaultConfig.profileId),
  modelId: z.string().default(defaultConfig.modelId),
  workspaceId: z.string().default(defaultConfig.workspaceId),
  enabled: z.boolean().default(defaultConfig.enabled),
  activityPipelineEnabled: z.boolean().default(defaultConfig.activityPipelineEnabled),
  activityPipelineIntervalMs: z.number().finite().positive().default(defaultConfig.activityPipelineIntervalMs),
  activityPipelineBatchSize: z.number().finite().positive().default(defaultConfig.activityPipelineBatchSize),
  dreamSchedulerEnabled: z.boolean().default(defaultConfig.dreamSchedulerEnabled),
  dreamSchedulerIntervalMs: z.number().finite().positive().default(defaultConfig.dreamSchedulerIntervalMs),
  dreamSchedulerApplyMerge: z.boolean().default(defaultConfig.dreamSchedulerApplyMerge),
  audioCaptureEnabled: z.boolean().default(defaultConfig.audioCaptureEnabled),
  audioSource: z.enum(['microphone', 'system', 'mixed']).default(defaultConfig.audioSource),
  audioSegmentMs: z.number().finite().positive().default(defaultConfig.audioSegmentMs),
  audioSegmentIntervalMs: z.number().finite().positive().default(defaultConfig.audioSegmentIntervalMs),
  audioRmsThreshold: z.number().finite().nonnegative().default(defaultConfig.audioRmsThreshold),
  storageRoot: z.string().default(defaultConfig.storageRoot),
  privacySensitiveAppBundleIds: ChroniclePrivacyRuleListSchema,
  privacySensitiveTitlePatterns: ChroniclePrivacyRuleListSchema,
  privacySensitiveUrlPatterns: ChroniclePrivacyRuleListSchema,
  closedEyesDiscardEnabled: z.boolean().default(defaultConfig.closedEyesDiscardEnabled),
  closedEyesMode: z.enum(['auto', 'always-record', 'always-pause']).default(defaultConfig.closedEyesMode),
})

const ChronicleConfigJsonSchema = z.union([
  ChronicleConfigSchema,
  z.string()
    .transform(value => JSON.parse(value))
    .pipe(ChronicleConfigSchema),
])

const ProfileConfigSchema = z.object({
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  modelId: z.string().optional(),
  apiKey: z.string().optional(),
  apiMode: z.enum(['responses', 'chat-completions']).optional(),
})

const ProfileConfigJsonSchema = z.union([
  ProfileConfigSchema,
  z.string()
    .transform(raw => JSON.parse(raw))
    .pipe(ProfileConfigSchema),
])

const NullableStringSchema = z.string()
  .trim()
  .transform(value => value.length > 0 ? value : null)
  .nullable()
  .default(null)

const NullableStringPatchSchema = z.string()
  .trim()
  .transform(value => value.length > 0 ? value : null)
  .nullable()
  .optional()

const AccessibilityEventProviderSchema = z.union([
  z.string().trim().pipe(z.union([
    z.string().min(1),
    z.literal('').transform(() => 'macos-ax-observer'),
  ])),
  z.null().transform(() => 'macos-ax-observer'),
  z.undefined().transform(() => 'macos-ax-observer'),
])

const JsonRecordSchema = z.record(z.string(), z.unknown()).default({})

const RatioBpsSchema = z.number()
  .finite()
  .min(0)
  .max(1)
  .transform(value => Math.round(value * 10_000))

const ClosedEyesVerdictSchema = z.object({
  status: z.enum(['open', 'closed', 'absent', 'unknown']).default('unknown'),
  confidence: RatioBpsSchema.nullable().optional().default(null),
  detector: NullableStringSchema,
  discard: z.boolean().nullable().optional().default(null),
  reason: NullableStringSchema,
  metadata: JsonRecordSchema,
}).transform(({ confidence, ...verdict }) => ({
  ...verdict,
  confidenceBps: confidence,
}))

const TimestampDateTextSchema = z.string()
  .trim()
  .regex(/\D/)
  .transform(value => Date.parse(value.replace(/(\d{2})-(\d{2})-(\d{2})Z$/, '$1:$2:$3Z')))
  .pipe(z.number().finite())
  .transform(value => Math.floor(value / 1000))

const TimestampSecondsTextSchema = z.string()
  .trim()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .transform(Number)
  .pipe(z.number().finite())
  .transform(value => Math.floor(value))

const UnixTimestampTextSchema = z.union([
  TimestampDateTextSchema,
  TimestampSecondsTextSchema,
])

const NullableUnixTimestampTextSchema = NullableStringSchema.pipe(z.union([
  UnixTimestampTextSchema,
  z.null(),
]))

const SlackTimestampTextSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/)
  .transform(value => Number(value.split('.')[0]))
  .pipe(z.number().int().nonnegative())

const SlackMessageTsTextSchema = z.string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/)

const SlackSignatureInputSchema = z.object({
  rawBody: z.string(),
  signature: z.string().min(1),
  timestamp: SlackMessageTsTextSchema,
  signingSecret: z.string(),
}).transform(input => ({
  ...input,
  timestampSeconds: SlackTimestampTextSchema.parse(input.timestamp),
}))

const EmbeddingBatchSchema = z.object({
  modelId: z.string(),
  modelVersion: z.string(),
  dimensions: z.number().int().positive(),
  embeddings: z.array(z.array(z.number().finite())),
}).superRefine((response, ctx) => {
  for (const [index, embedding] of response.embeddings.entries()) {
    if (embedding.length !== response.dimensions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['embeddings', index],
        message: 'Embedding vector dimensions do not match the response dimensions',
      })
    }
  }
})

const ChannelIdsSchema = z.array(z.string())
  .transform(channelIds => [...new Set(channelIds.map(channelId => channelId.trim()).filter(Boolean))])

const SpeakerDisplayNameSchema = z.string()
  .trim()
  .min(1, 'Speaker displayName is required')
  .transform(value => value.replace(/\s+/g, ' '))

const SpeakerAliasesSchema = z.array(z.string())
  .default([])
  .transform((values) => {
    const aliases = values
      .map(value => value.trim().replace(/\s+/g, ' '))
      .filter(value => value.length > 0)
    return [...new Map(aliases.map(value => [value.toLocaleLowerCase(), value])).values()]
  })

const SpeakerEmbeddingSchema = z.array(z.coerce.number().finite())
  .min(1, 'Speaker embedding must contain finite numeric values')
  .nullable()
  .optional()

const NonNegativeIntegerSchema = z.number()
  .finite()
  .nonnegative()
  .transform(value => Math.floor(value))

const SlackSourceConfigSchema = z.object({
  realtimeMode: z.enum(['polling', 'events-api', 'socket-mode']).default('polling'),
  signingSecretRef: NullableStringSchema,
  socketAppTokenRef: NullableStringSchema,
})

const ConfigurableSlackRealtimeModeSchema = z.enum(['polling', 'events-api'])

const SlackSourceConfigPatchSchema = z.object({
  current: SlackSourceConfigSchema,
  patch: z.object({
    realtimeMode: ConfigurableSlackRealtimeModeSchema.optional(),
    signingSecretRef: NullableStringPatchSchema,
    socketAppTokenRef: NullableStringPatchSchema,
  }),
}).transform(({ current, patch }) => ({
  realtimeMode: patch.realtimeMode ?? current.realtimeMode,
  signingSecretRef: patch.signingSecretRef === undefined ? current.signingSecretRef : patch.signingSecretRef,
  socketAppTokenRef: patch.socketAppTokenRef === undefined ? current.socketAppTokenRef : patch.socketAppTokenRef,
}))

const ModelResourceLocalFileInputSchema = z.object({
  relativePath: z.string(),
  sourcePath: z.string().trim().min(1),
})

const ModelResourceInstallInputSchema = z.object({
  source: z.enum(['manifest', 'local-files']).default('manifest'),
  sourceRoot: NullableStringSchema,
  files: z.array(ModelResourceLocalFileInputSchema).default([]),
})

const MessageSourceInputSchema = z.object({
  platform: z.literal('slack'),
  label: z.string(),
  enabled: z.boolean(),
  workspaceId: NullableStringSchema,
  teamId: NullableStringSchema,
  botTokenRef: NullableStringSchema,
  channelIds: ChannelIdsSchema,
  realtimeMode: ConfigurableSlackRealtimeModeSchema.optional(),
  signingSecretRef: NullableStringSchema,
  socketAppTokenRef: NullableStringSchema,
})

const MessageSourcePatchInputSchema = z.object({
  label: z.string().optional(),
  enabled: z.boolean().optional(),
  workspaceId: NullableStringPatchSchema,
  teamId: NullableStringPatchSchema,
  botTokenRef: NullableStringPatchSchema,
  channelIds: ChannelIdsSchema.optional(),
  realtimeMode: ConfigurableSlackRealtimeModeSchema.optional(),
  signingSecretRef: NullableStringPatchSchema,
  socketAppTokenRef: NullableStringPatchSchema,
})

const MemoryCrystallizeInputSchema = z.object({
  segmentId: z.string().optional(),
}).default({})

const AudioTranscriptSegmentInputSchema = z.object({
  startMs: z.number().finite().transform(value => Math.floor(value)),
  endMs: z.number().finite().nullable().optional().default(null).transform(value => value === null ? null : Math.floor(value)),
  speakerLabel: NullableStringSchema,
  text: z.string(),
  confidence: RatioBpsSchema.nullable().optional().default(null),
  language: NullableStringSchema,
  metadata: JsonRecordSchema,
}).superRefine((segment, ctx) => {
  if (segment.endMs !== null && segment.endMs < segment.startMs) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endMs'],
      message: 'Audio transcript segment endMs must be greater than or equal to startMs',
    })
  }
}).transform(({ confidence, ...segment }) => {
  return {
    ...segment,
    confidenceBps: confidence,
  }
})

const AudioTranscriptReportInputSchema = z.object({
  sourceId: z.string(),
  title: NullableStringSchema,
  source: z.enum(['asr', 'manual', 'imported']).default('imported'),
  status: z.enum(['recording', 'completed', 'imported', 'error']).optional(),
  startedAt: UnixTimestampTextSchema,
  endedAt: NullableUnixTimestampTextSchema,
  language: NullableStringSchema,
  appBundleId: NullableStringSchema,
  windowTitle: NullableStringSchema,
  audioPath: NullableStringSchema,
  transcriptPath: NullableStringSchema,
  segments: z.array(AudioTranscriptSegmentInputSchema),
  metadata: JsonRecordSchema,
}).superRefine((input, ctx) => {
  if (input.endedAt !== null && input.endedAt < input.startedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endedAt'],
      message: 'Audio transcript endedAt must be greater than or equal to startedAt',
    })
  }
}).transform((input) => {
  const status = input.status === undefined
    ? input.source === 'asr' ? 'completed' : 'imported'
    : input.status
  const activityFrontApp = input.appBundleId === null ? 'audio' : input.appBundleId
  let activityTitle = 'Audio transcript'
  if (input.title !== null) {
    activityTitle = input.title
  }
  else if (input.windowTitle !== null) {
    activityTitle = input.windowTitle
  }
  return {
    ...input,
    status,
    activityFrontApp,
    activityTitle,
  }
})

const SpeakerProfileInputSchema = z.object({
  displayName: SpeakerDisplayNameSchema,
  aliases: SpeakerAliasesSchema,
  embedding: SpeakerEmbeddingSchema,
  embeddingModelId: NullableStringSchema,
  sampleCount: NonNegativeIntegerSchema.optional(),
  lastSeenAt: NullableStringSchema.transform(value => value === null ? null : UnixTimestampTextSchema.parse(value)),
  metadata: JsonRecordSchema,
})

const AccessibilitySnapshotReportInputSchema = z.object({
  sourceId: z.string(),
  status: z.enum(['ready', 'permission-denied', 'unavailable', 'error']).default('ready'),
  provider: z.string().default('macos-accessibility'),
  accessibilityPath: NullableStringSchema,
  text: NullableStringSchema,
  elementCount: z.number().default(0),
  appBundleId: NullableStringSchema,
  windowTitle: NullableStringSchema,
  tree: z.array(z.unknown()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
})

const AccessibilityEventReportInputSchema = z.object({
  sourceId: z.string(),
  capturedAt: UnixTimestampTextSchema,
  provider: AccessibilityEventProviderSchema.default('macos-ax-observer'),
  appBundleId: NullableStringSchema,
  pid: z.number().nullable().default(null).transform(value => value === null ? null : Math.trunc(value)),
  notification: z.string().trim().min(1).transform(value => boundedString(value, 160)),
  droppedBefore: z.number().default(0).transform(value => Math.max(0, Math.floor(value))),
  snapshotId: NullableStringSchema,
  accessibilitySnapshotId: NullableStringSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
})

const ChronicleSnapshotReportInputSchema = z.object({
  sourceId: z.string(),
  displayId: z.number(),
  frameIndex: z.number().nullable().default(null),
  capturedAt: UnixTimestampTextSchema,
  segmentDir: z.string(),
  framePath: z.string(),
  capturePath: NullableStringSchema,
  ocrPath: NullableStringSchema,
  snapshotPath: NullableStringSchema,
  ocrText: NullableStringSchema,
  appBundleId: NullableStringSchema,
  windowTitle: NullableStringSchema,
  closedEyes: ClosedEyesVerdictSchema.optional(),
  accessibility: AccessibilitySnapshotReportInputSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
})
type ChronicleSnapshotReport = z.infer<typeof ChronicleSnapshotReportInputSchema>

const ChronicleMemoryReportInputSchema = z.object({
  sourceId: z.string(),
  windowType: z.enum(['10min', '6h']),
  createdAt: UnixTimestampTextSchema,
  memoryPath: z.string().optional(),
  content: z.string(),
  summaryKind: z.enum(['llm', 'local', 'imported']),
  sourceSnapshotPaths: z.array(z.string()).default([]),
  sourceFramePaths: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
})
type ChronicleMemoryReport = z.infer<typeof ChronicleMemoryReportInputSchema>

const ChronicleMemoryUpdateInputSchema = z.object({
  content: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sourceSnapshotPaths: z.array(z.string()).optional(),
  sourceFramePaths: z.array(z.string()).optional(),
})

const ChronicleMemoryUsageSchema = z.object({
  promptTokens: z.number().finite().nonnegative(),
  completionTokens: z.number().finite().nonnegative(),
  totalTokens: z.number().finite().nonnegative(),
})

const ChronicleMemoryRecordOptionsSchema = z.object({
  prompt: z.string().optional(),
  modelId: z.string().optional(),
  profileId: z.string().optional(),
  usage: ChronicleMemoryUsageSchema.or(JsonRecordSchema).default({}),
  sourceSnapshotIds: z.array(z.string()).optional(),
  skipActivityAssignment: z.boolean().optional(),
})

const SLACK_SYNC_INTERVAL_MS = 60_000
const ACTIVITY_PIPELINE_MIN_INTERVAL_MS = 30_000
const ACTIVITY_PIPELINE_MAX_INTERVAL_MS = 3_600_000
const ACTIVITY_PIPELINE_MIN_BATCH_SIZE = 1
const ACTIVITY_PIPELINE_MAX_BATCH_SIZE = 20
const SLACK_SIGNATURE_VERSION = 'v0'
const SLACK_SIGNATURE_TOLERANCE_SECONDS = 300
const MEMORY_CHUNK_MAX_CHARS = 1_800
const MEMORY_SEARCH_MAX_TERMS = 12
const MEMORY_TOKEN_MIN_LENGTH = 2
const MEMORY_EMBEDDING_DIMENSIONS = 64
const MEMORY_EMBEDDING_MODEL_ID = 'chronicle-lexical'
const MEMORY_EMBEDDING_MODEL_VERSION = 'v1'
const ONNX_TEXT_EMBEDDING_MODEL_ID = 'all-MiniLM-L6-v2'
const ONNX_TEXT_EMBEDDING_MODEL_VERSION = 'onnx-minilm-l6-v2'
const MEMORY_SEMANTIC_SCORE_WEIGHT = 12
const MEMORY_SEMANTIC_MIN_SCORE = 0.28
const ACTIVITY_IDLE_BOUNDARY_SECONDS = 10 * 60
const ACTIVITY_MAX_SEGMENT_SECONDS = 30 * 60
const MODEL_RESOURCE_FETCH_TIMEOUT_MS = 30_000
const EMBEDDING_RUNTIME_HEALTH_TIMEOUT_MS = 5_000
const EMBEDDING_RUNTIME_HEALTH_CACHE_MS = 60_000
const DREAM_SCHEDULER_MIN_INTERVAL_MS = 3_600_000
const DREAM_SCHEDULER_MAX_INTERVAL_MS = 7 * 86_400_000
const ACTIVITY_SESSION_GAP_SECONDS = 6 * 60 * 60

const ModelResourceFetchTimeoutMsSchema = z.string()
  .transform(value => Number.parseInt(value, 10))
  .pipe(z.number().int().positive())
  .default(MODEL_RESOURCE_FETCH_TIMEOUT_MS)

let embeddingRuntimeHealth: {
  checkedAtMs: number
  ok: boolean
  error: string | null
} | null = null

type ChronicleDb = ReturnType<typeof db>
type ChronicleTx = Parameters<Parameters<ChronicleDb['transaction']>[0]>[0]

type ModelResourceCategory = 'ocr' | 'audio-vad' | 'audio-asr' | 'speaker' | 'embedding' | 'pii'
const ModelResourceCategorySchema = z.enum(['ocr', 'audio-vad', 'audio-asr', 'speaker', 'embedding', 'pii'])
type ModelResourceStatus = 'available' | 'missing' | 'installing' | 'installed' | 'error'
type AudioProcessingStatus = 'not-implemented' | 'pending' | 'ready' | 'error'
type SlackSyncTrigger = 'manual' | 'background'
type SlackRealtimeMode = 'polling' | 'events-api' | 'socket-mode'
type SlackConfigurableRealtimeMode = Extract<SlackRealtimeMode, 'polling' | 'events-api'>
type ActivitySegmentType = 'work' | 'meeting' | 'browsing' | 'chat' | 'audio' | 'idle' | 'unknown'
type ActivityPipelineTrigger = 'snapshot' | 'message' | 'audio-raw' | 'audio-transcript' | 'memory' | 'manual' | 'summarize'
type ActivityPipelineStage = 'collection' | 'segmentation' | 'triage' | 'summarization' | 'crystallization'
type ActivityPipelineRunStatus = 'queued' | 'running' | 'success' | 'error' | 'skipped'
type KnowledgeCardType = 'fact' | 'insight' | 'decision' | 'task' | 'pattern'
type KnowledgeDimension = 'technical' | 'business' | 'personal' | 'project' | 'general'
type KnowledgeCardStatus = 'active' | 'merged' | 'archived' | 'deleted'
type DreamRunType = 'archive' | 'merge' | 'prune' | 'restore' | 'dry-run'
type DreamStartRunType = DreamRunType
type DreamRunStatus = 'running' | 'completed' | 'failed'

interface SlackSourceConfig {
  realtimeMode: SlackRealtimeMode
  signingSecretRef: string | null
  socketAppTokenRef: string | null
}

interface ModelResourceFileManifest {
  path: string
  sha256?: string
  sizeBytes?: number
  sourceUrl?: string
  fallbackUrls: string[]
  required: boolean
}

interface ModelResourceManifest {
  category: ModelResourceCategory
  displayName: string
  version: string
  runtime: string
  required: boolean
  message: string
  files: ModelResourceFileManifest[]
  metadata: Record<string, unknown>
}

interface ModelResourceFileCheck {
  relativePath: string
  absolutePath: string
  required: boolean
  exists: boolean
  expectedSizeBytes?: number
  actualSizeBytes?: number
  sha256?: string
  actualSha256?: string
}

interface MemorySearchScore {
  keywordScore: number
  semanticScore: number
}

interface TextEmbeddingVector {
  vector: number[]
  modelId: string
  modelVersion: string
  provider: 'onnx' | 'lexical'
}

const ModelResourceFileManifestSchema = z.object({
  path: z.string(),
  sha256: z.string().optional(),
  sizeBytes: z.number().finite().positive().optional(),
  sourceUrl: z.string().optional(),
  fallbackUrls: z.array(z.string()).default([]),
  required: z.boolean().default(true),
})

const ModelResourceManifestSchema = z.object({
  category: ModelResourceCategorySchema,
  displayName: z.string(),
  version: z.string(),
  runtime: z.string(),
  required: z.boolean(),
  message: z.string(),
  files: z.array(ModelResourceFileManifestSchema),
  metadata: JsonRecordSchema,
})

interface ChronicleLanguageModelContext {
  model: LanguageModel
  modelId: string
  profileId: string
}

type ChronicleLanguageModelContextResult
  = | { ok: true, context: ChronicleLanguageModelContext }
    | { ok: false, message: string }

interface ActivitySegmentContext {
  segment: typeof chronicleActivitySegments.$inferSelect
  sourceRefs: z.infer<typeof ActivitySourceRefsSchema>
  evidenceText: string
  evidenceCounts: Record<string, number>
}

interface ActivitySummaryResult {
  title: string
  summary: string
  keyPoints: string[]
  entities: string[]
  followUps: string[]
}

interface CrystallizedKnowledgeCardDraft {
  title: string
  content: string
  cardType: KnowledgeCardType
  dimension: KnowledgeDimension
  confidenceBps: number
  tags: string[]
  stableKey: string
}

function stripModelJsonMarkdownFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\n?```$/i.exec(trimmed)
  return fenced ? fenced[1].trim() : trimmed
}

const ModelTextJsonObjectSchema = z.string()
  .transform(raw => JSON.parse(stripModelJsonMarkdownFence(raw)))
  .pipe(z.record(z.string(), z.unknown()))

const ActivitySegmentTypeSchema = z.enum(['work', 'meeting', 'browsing', 'chat', 'audio', 'idle', 'unknown'])
const ActivityPrioritySchema = z.enum(['low', 'normal', 'high'])
const KnowledgeCardTypeSchema = z.enum(['fact', 'insight', 'decision', 'task', 'pattern'])
const KnowledgeDimensionSchema = z.enum(['technical', 'business', 'personal', 'project', 'general'])
const KnowledgeCardStatusSchema = z.enum(['active', 'merged', 'archived', 'deleted'])
const DreamStartRunTypeSchema = z.enum(['archive', 'merge', 'prune', 'restore', 'dry-run'])
const ModelStringListSchema = z.array(z.string().min(1)).default([])
const KnowledgeCardMutationBaseInputSchema = z.object({
  title: z.string().trim().min(1).transform(value => boundedString(value, 240)),
  content: z.string().trim().min(1).transform(value => boundedString(value, 4_000)),
  cardType: KnowledgeCardTypeSchema.default('fact'),
  dimension: KnowledgeDimensionSchema.default('general'),
  confidence: z.number().finite().min(0).max(1).default(1),
  sourceMemoryIds: ModelStringListSchema.default([]),
  sourceSegmentIds: ModelStringListSchema.default([]),
  sourceChunkIds: ModelStringListSchema.default([]),
  tags: ModelStringListSchema.default([]).transform(values => uniqueStrings(values.map(tag => boundedString(tag.trim(), 64)).filter(Boolean)).slice(0, 24)),
  stableKey: z.string().trim().optional(),
  pinned: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({}),
})
const KnowledgeCardMutationInputSchema = KnowledgeCardMutationBaseInputSchema.transform((input) => {
  const stableKey = input.stableKey === undefined
    ? hashText(`${input.dimension}:${input.cardType}:${canonicalizeMemoryContent(input.title)}:${canonicalizeMemoryContent(input.content).slice(0, 256)}`).slice(0, 32)
    : input.stableKey
  return {
    ...input,
    stableKey: boundedString(stableKey, 160),
  }
})
const KnowledgeCardPatchInputSchema = z.object({
  title: z.string().trim().min(1).transform(value => boundedString(value, 240)).optional(),
  content: z.string().trim().min(1).transform(value => boundedString(value, 4_000)).optional(),
  cardType: KnowledgeCardTypeSchema.optional(),
  dimension: KnowledgeDimensionSchema.optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
  sourceMemoryIds: ModelStringListSchema.optional(),
  sourceSegmentIds: ModelStringListSchema.optional(),
  sourceChunkIds: ModelStringListSchema.optional(),
  tags: ModelStringListSchema.transform(values => uniqueStrings(values.map(tag => boundedString(tag.trim(), 64)).filter(Boolean)).slice(0, 24)).optional(),
  pinned: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: KnowledgeCardStatusSchema.optional(),
  mergedIntoId: z.string().nullable().optional(),
})
const BoundedRealtimeLimitSchema = z.number()
  .default(50)
  .transform(value => Math.min(Math.max(Math.floor(value), 1), 500))
const BoundedPrivacyExportLimitSchema = z.number()
  .default(50)
  .transform(value => Math.max(1, Math.min(value, 200)))
const BoundedKnowledgeCardLimitSchema = z.number()
  .default(50)
  .transform(value => Math.max(1, Math.min(value, 200)))
const BoundedDreamRunListLimitSchema = z.number()
  .default(20)
  .transform(value => Math.max(1, Math.min(value, 100)))
const BoundedDreamRunLimitSchema = z.number()
  .default(80)
  .transform(value => Math.max(2, Math.min(value, 300)))
const BoundedDreamThresholdSchema = z.number()
  .default(0.76)
  .transform(value => boundedNumber(value, 0.1, 1))
const NonNegativeDayCountSchema = z.number()
  .default(30)
  .transform(value => Math.max(0, Math.floor(value)))
const JsonRecordTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(JsonRecordSchema)
const RealtimeAttrsTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    privacyKind: z.string().optional(),
  }).passthrough())
const StringListTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ModelStringListSchema.default([]))
const ActivitySourceCountsSchema = z.object({
  snapshotIds: z.number().finite().nonnegative().default(0),
  messageIds: z.number().finite().nonnegative().default(0),
  audioTranscriptIds: z.number().finite().nonnegative().default(0),
  audioRawSegmentIds: z.number().finite().nonnegative().default(0),
  memoryIds: z.number().finite().nonnegative().default(0),
  accessibilitySnapshotIds: z.number().finite().nonnegative().default(0),
})
const ActivitySourceCountsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ActivitySourceCountsSchema)
const JsonListTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(z.unknown()).default([]))
const NumberListTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(z.number().finite()))
const MemoryActivityMetadataSchema = z.object({
  appBundleId: z.string().nullable().default(null),
  title: z.string().nullable().default(null),
}).passthrough()
const SnapshotOcrMetadataTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    ocrPath: z.string().nullable().default(null),
  }).passthrough())
const DuplicateMemoryMetadataTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    duplicateSourceIds: ModelStringListSchema.default([]),
  }).passthrough())
const SlackSourceConfigJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(SlackSourceConfigSchema)
const SlackUrlVerificationPayloadSchema = z.object({
  type: z.literal('url_verification'),
  challenge: z.string().min(1),
}).passthrough()
const SlackMessageEventBaseSchema = z.object({
  type: z.union([z.literal('message'), z.literal('app_mention')]),
  subtype: z.string().optional(),
  channel: z.string().min(1),
  ts: SlackMessageTsTextSchema,
  text: z.string(),
  channel_name: z.string().nullable().default(null),
  user: z.string().optional(),
  bot_id: z.string().optional(),
  username: z.string().nullable().default(null),
  thread_ts: SlackMessageTsTextSchema.optional(),
}).passthrough()
const SlackEventsPayloadJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({ type: z.string() }).passthrough())
const SlackEventCallbackPayloadParseSchema = z.object({
  type: z.literal('event_callback'),
  team_id: z.string().optional(),
  event: SlackMessageEventBaseSchema.safeExtend({
    text: z.string().trim().min(1),
  }).transform(message => ({
    ...message,
    userId: message.user || message.bot_id || null,
    threadId: message.thread_ts || message.ts,
  })),
}).passthrough()
const SlackHistoryMessageSchema = SlackMessageEventBaseSchema.omit({ type: true, channel: true }).safeExtend({
  text: z.string().trim().min(1),
}).transform(message => ({
  ...message,
  userId: message.user || message.bot_id || null,
  threadId: message.thread_ts || message.ts,
}))
const SlackAttachmentsSchema = z.array(z.unknown()).default([])

const ActivitySourceRefsSchema = z.object({
  snapshotIds: ModelStringListSchema.default([]),
  messageIds: ModelStringListSchema.default([]),
  audioTranscriptIds: ModelStringListSchema.default([]),
  audioRawSegmentIds: ModelStringListSchema.default([]),
  memoryIds: ModelStringListSchema.default([]),
  accessibilitySnapshotIds: ModelStringListSchema.default([]),
})
const AudioProcessingStatusSchema = z.enum(['not-implemented', 'pending', 'ready', 'error'])
const AudioRawSegmentReportInputSchema = z.object({
  sourceId: z.string(),
  recordedAt: UnixTimestampTextSchema,
  source: z.enum(['microphone', 'system', 'mixed']).default('microphone'),
  status: z.enum(['captured', 'queued', 'processed', 'ignored', 'error']).default('captured'),
  audioPath: z.string(),
  metadataPath: z.string(),
  sampleRate: z.number().finite().positive().transform(value => Math.floor(value)),
  channels: z.number().finite().positive().transform(value => Math.floor(value)),
  sampleCount: z.number().finite().nonnegative().transform(value => Math.floor(value)),
  droppedSamples: z.number().finite().nonnegative().default(0).transform(value => Math.floor(value)),
  durationMs: z.number().finite().nonnegative().optional(),
  rms: z.number().finite().transform(value => Math.round(Math.max(0, Math.min(1, value)) * 10_000)),
  peak: z.number().finite().transform(value => Math.round(Math.max(0, Math.min(1, value)) * 10_000)),
  active: z.boolean(),
  vadImplemented: z.boolean().default(false),
  asrImplemented: z.boolean().default(false),
  speakerLabelingImplemented: z.boolean().default(false),
  metadata: JsonRecordSchema,
}).transform(input => ({
  ...input,
  durationMs: z.number().default(() => Math.round((input.sampleCount / input.sampleRate) * 1000)).parse(input.durationMs),
}))
const AudioRawSegmentProcessingResultInputSchema = z.object({
  status: z.enum(['captured', 'queued', 'processed', 'ignored', 'error']).optional(),
  vadStatus: AudioProcessingStatusSchema.optional(),
  asrStatus: AudioProcessingStatusSchema.optional(),
  speakerStatus: AudioProcessingStatusSchema.optional(),
  transcriptSourceId: NullableStringSchema,
  speakerProfileIds: ModelStringListSchema.default([]),
  errorMessage: NullableStringSchema,
  metadata: JsonRecordSchema,
})
const AudioRawSegmentProcessingStateSchema = z.object({
  status: z.enum(['captured', 'queued', 'processed', 'ignored', 'error']),
  vadStatus: AudioProcessingStatusSchema,
  asrStatus: AudioProcessingStatusSchema,
  speakerStatus: AudioProcessingStatusSchema,
})
const ActivityAssignmentInputSchema = z.object({
  trigger: z.enum(['snapshot', 'message', 'audio-raw', 'audio-transcript', 'memory', 'manual', 'summarize']),
  workspaceId: z.string().nullable(),
  occurredAt: z.number().finite().transform(value => Math.floor(value)),
  segmentType: ActivitySegmentTypeSchema,
  frontApp: z.string().nullable(),
  title: z.string().nullable(),
  summary: z.string().nullable().default(null),
  refs: ActivitySourceRefsSchema,
  metadata: JsonRecordSchema,
})
const ChronicleEventInputSchema = z.object({
  type: z.enum(['config', 'daemon', 'snapshot', 'memory', 'summarize', 'model-resource', 'message', 'audio', 'activity']),
  status: z.enum(['info', 'success', 'warning', 'error']),
  message: z.string(),
  snapshotId: z.string().nullable().default(null),
  memoryId: z.string().nullable().default(null),
  attrs: JsonRecordSchema,
})

const PrivacyBreadcrumbInputSchema = z.object({
  kind: z.string(),
  status: z.enum(['info', 'success', 'warning', 'error']),
  message: z.string(),
  snapshotId: z.string().nullable().default(null),
  memoryId: z.string().nullable().default(null),
  attrs: JsonRecordSchema,
})

const PrivacyFrameMaskRegionSchema = z.object({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
})

const PrivacyFrameMaskInputSchema = z.object({
  mode: z.literal('blur').default('blur'),
  fullFrame: z.boolean().default(false),
  blurSigma: z.number().finite().min(1).max(100).default(24),
  regions: z.array(PrivacyFrameMaskRegionSchema).default([]),
})

const RealtimeEventsInputSchema = z.object({
  limit: BoundedRealtimeLimitSchema,
  after: z.number().optional().transform(value => value === undefined ? null : Math.max(Math.floor(value), 0)),
}).prefault({})

const PrivacyExportInputSchema = z.object({
  workspaceId: z.string().nullable().optional(),
  limit: BoundedPrivacyExportLimitSchema,
  includeMemories: z.boolean().default(true),
  includeMessages: z.boolean().default(true),
  includeAudioTranscripts: z.boolean().default(true),
  includeSnapshots: z.boolean().default(true),
  outputFormat: z.enum(['markdown', 'json']).default('markdown'),
}).prefault({})

const KnowledgeCardListInputSchema = z.object({
  limit: BoundedKnowledgeCardLimitSchema,
  dimension: KnowledgeDimensionSchema.optional(),
  cardType: KnowledgeCardTypeSchema.optional(),
  status: KnowledgeCardStatusSchema.optional(),
  includeDeleted: z.boolean().default(false),
}).prefault({})

const DreamRunListLimitSchema = BoundedDreamRunListLimitSchema

const DreamRunInputSchema = z.object({
  runType: DreamStartRunTypeSchema.default('merge'),
  dryRun: z.boolean().optional(),
  limit: BoundedDreamRunLimitSchema,
  similarityThreshold: BoundedDreamThresholdSchema,
  applyMerge: z.boolean().optional(),
  olderThanDays: NonNegativeDayCountSchema,
  knowledgeIds: ModelStringListSchema,
}).prefault({}).transform(input => ({
  ...input,
  dryRun: input.dryRun !== false && input.applyMerge !== true,
}))

const PrivacyBreadcrumbAttrsSchema = z.object({
  privacyKind: z.string().default('unknown'),
  source: z.string().nullable().default(null),
}).passthrough()
const PrivacyBreadcrumbAttrsTextSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(PrivacyBreadcrumbAttrsSchema)

const ActivitySourceRefsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ActivitySourceRefsSchema)

const ActivityPipelineMemoryIdsJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(ModelStringListSchema.default([]))

const ActivityCrystallizationRunResultJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    knowledgeCardIds: ModelStringListSchema.default([]),
  }))

const ActivitySegmentMetadataJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    summarization: z.object({
      memoryId: z.string().nullable().default(null),
    }).default({ memoryId: null }),
  }).passthrough())

const ActivityTriageModelTextSchema = ModelTextJsonObjectSchema.pipe(z.object({
    keep: z.boolean().default(false),
    reason: z.string().default('No useful activity evidence'),
    segmentType: ActivitySegmentTypeSchema.default('unknown'),
    title: z.string().nullable().default(null),
    priority: ActivityPrioritySchema.default('normal'),
  }))

const ActivitySummaryModelTextSchema = ModelTextJsonObjectSchema.pipe(z.object({
    title: z.string().default('Activity summary'),
    summary: z.string().default(''),
    keyPoints: ModelStringListSchema.default([]),
    entities: ModelStringListSchema.default([]),
    followUps: ModelStringListSchema.default([]),
  }))

const ChronicleSummarizeInputSchema = z.object({
  prompt: z.string(),
  windowType: z.enum(['10min', '6h']),
  sourceSnapshotIds: ModelStringListSchema.default([]),
  sourceArtifactPaths: ModelStringListSchema.default([]),
})

const SpeakerProfileUpsertInputSchema = z.object({
  workspaceId: z.string().nullable(),
  displayName: SpeakerDisplayNameSchema,
  aliases: SpeakerAliasesSchema,
  embedding: SpeakerEmbeddingSchema,
  embeddingModelId: NullableStringSchema,
  sampleCount: z.number().finite().nonnegative().default(1).transform(value => Math.floor(value)),
  seenAt: z.number().finite().nullable().optional(),
  transcriptId: NullableStringSchema,
  segmentId: NullableStringSchema,
  metadata: JsonRecordSchema,
  now: z.number().finite().default(() => currentUnixSeconds()),
})

const CrystallizedKnowledgeCardDraftSchema = z.object({
  title: z.string().trim().min(1).transform(value => boundedString(value, 240)),
  content: z.string().trim().min(1).transform(value => boundedString(value, 4_000)),
  type: KnowledgeCardTypeSchema.default('fact'),
  dimension: KnowledgeDimensionSchema.default('general'),
  confidence: z.number().finite().min(0).max(1).default(1),
  tags: ModelStringListSchema.default([]).transform(values => uniqueStrings(values.map(tag => boundedString(tag.trim(), 64)).filter(Boolean)).slice(0, 12)),
  stableKey: z.string().trim().optional(),
}).transform((card): CrystallizedKnowledgeCardDraft => {
  const fallbackStableKey = hashText(`${card.dimension}:${card.type}:${canonicalizeMemoryContent(card.title)}:${canonicalizeMemoryContent(card.content).slice(0, 256)}`).slice(0, 32)
  return {
    title: card.title,
    content: card.content,
    cardType: card.type,
    dimension: card.dimension,
    confidenceBps: RatioBpsSchema.parse(card.confidence),
    tags: card.tags,
    stableKey: boundedString(card.stableKey ?? fallbackStableKey, 160) || fallbackStableKey,
  }
})

const ActivityCrystallizationModelTextSchema = ModelTextJsonObjectSchema.pipe(z.object({
    summary: z.string().default('').transform(value => boundedString(value, 4_000)),
    knowledgeCards: z.array(CrystallizedKnowledgeCardDraftSchema).default([]),
    rejectedCount: z.number().finite().nonnegative().transform(value => Math.floor(value)).default(0),
  }))

interface DreamMergeCandidateDraft {
  workspaceId: string | null
  sourceKnowledgeIds: string[]
  proposedTitle: string
  proposedContent: string
  proposedCardType: KnowledgeCardType
  proposedDimension: KnowledgeDimension
  score: number
  reason: string
  vectorMode: string
}

interface KnowledgeCardMaterialPatch {
  title: string
  content: string
  cardType: KnowledgeCardType
  dimension: KnowledgeDimension
  confidenceBps: number
  sourceMemoryIdsJson: string
  sourceSegmentIdsJson: string
  sourceChunkIdsJson: string
  tagsJson: string
  contentHash: string
  status: KnowledgeCardStatus
  mergedIntoId: string | null
  pinned: boolean
  metadataJson: string
}

export interface ModelResourceEntry {
  id: string
  category: ModelResourceCategory
  status: ModelResourceStatus
  displayName: string
  path: string | null
  version: string | null
  message: string | null
  sizeBytes: number | null
  metadata: Record<string, unknown>
  updatedAt: number
}

export interface ModelResourceLocalFileInput {
  relativePath: string
  sourcePath: string
}

export interface ModelResourceInstallInput {
  source?: 'manifest' | 'local-files'
  sourceRoot?: string | null
  files?: ModelResourceLocalFileInput[]
}

let slackSyncTimer: ReturnType<typeof setInterval> | null = null
let slackSyncRunning = false
let activityPipelineTimer: ReturnType<typeof setInterval> | null = null
let activityPipelineRunning = false
let dreamSchedulerTimer: ReturnType<typeof setInterval> | null = null
let dreamSchedulerRunning = false
let memorySearchIndexReconciledDbPath: string | null = null
const activeSlackSyncs = new Set<string>()

// --- Download progress tracking ---
export interface DownloadProgressEntry {
  category: string
  file: string
  totalBytes: number | null
  downloadedBytes: number
  status: 'downloading' | 'done' | 'error'
  error?: string
  startedAt: number
}

const downloadProgress = new Map<string, DownloadProgressEntry>()
const downloadProgressListeners = new Set<(entry: DownloadProgressEntry) => void>()

export function getDownloadProgress(): DownloadProgressEntry[] {
  return [...downloadProgress.values()]
}

export function subscribeDownloadProgress(listener: (entry: DownloadProgressEntry) => void): () => void {
  downloadProgressListeners.add(listener)
  return () => { downloadProgressListeners.delete(listener) }
}

function emitDownloadProgress(entry: DownloadProgressEntry): void {
  downloadProgress.set(`${entry.category}/${entry.file}`, entry)
  for (const listener of downloadProgressListeners) {
    try { listener(entry) }
 catch {}
  }
}
// --- End download progress tracking ---

const rawBuiltInModelManifests = {
  'ocr': {
    category: 'ocr',
    displayName: 'Screen OCR',
    version: 'macos-vision',
    runtime: 'macos-vision',
    required: true,
    message: 'macOS Vision OCR is available without a downloaded model.',
    files: [],
    metadata: { provider: 'macos-vision', requiredFor: ['screen-capture'] },
  },
  'audio-vad': {
    category: 'audio-vad',
    displayName: 'Voice Activity Detection',
    version: 'silero-vad',
    runtime: 'sherpa-onnx',
    required: false,
    message: 'Place or install silero_vad.onnx to enable local audio activity detection.',
    files: [{
      path: 'audio-vad/silero_vad.onnx',
      sourceUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
      sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
      sizeBytes: 643_854,
      required: true,
    }],
    metadata: { requiredFor: ['audio-transcription'] },
  },
  'audio-asr': {
    category: 'audio-asr',
    displayName: 'Speech Recognition',
    version: 'sensevoice-2024-07-17',
    runtime: 'sherpa-onnx',
    required: false,
    message: 'Place or install SenseVoice model.int8.onnx and tokens.txt to enable local speech transcription.',
    files: [
      {
        path: 'audio-asr/sensevoice/model.int8.onnx',
        sourceUrl: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx',
        fallbackUrls: [
          'https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx',
        ],
        required: true,
      },
      {
        path: 'audio-asr/sensevoice/tokens.txt',
        sourceUrl: 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt',
        fallbackUrls: [
          'https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt',
        ],
        required: true,
      },
    ],
    metadata: { requiredFor: ['audio-transcription'], languages: ['zh', 'en', 'ja', 'ko', 'yue'] },
  },
  'speaker': {
    category: 'speaker',
    displayName: 'Speaker Embedding Extractor',
    version: '3dspeaker-campplus-zh-en-16k',
    runtime: 'sherpa-onnx',
    required: false,
    message: 'Sherpa speaker embedding extractor model for local speaker profiles and meeting speaker labeling.',
    files: [{
      path: 'speaker/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
      sourceUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
      sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
      sizeBytes: 28_281_164,
      required: true,
    }],
    metadata: {
      requiredFor: ['speaker-labeling', 'meeting-transcription'],
      function: 'speaker-embedding-extractor',
      sampleRate: 16_000,
      languages: ['zh', 'en'],
    },
  },
  'embedding': {
    category: 'embedding',
    displayName: 'Text Embedding',
    version: 'all-MiniLM-L6-v2',
    runtime: 'onnx',
    required: false,
    message: 'all-MiniLM-L6-v2 ONNX model for local text embedding and future neural memory ranking.',
    files: [
      {
        path: 'embedding/model.onnx',
        sourceUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx',
        fallbackUrls: [
          'https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx',
        ],
        required: true,
      },
      {
        path: 'embedding/tokenizer.json',
        sourceUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
        fallbackUrls: [
          'https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
        ],
        required: true,
      },
    ],
    metadata: { requiredFor: ['neural-memory-ranking'], currentRuntime: 'chronicle-lexical', distance: 'cosine' },
  },
  'pii': {
    category: 'pii',
    displayName: 'PII Detection',
    version: 'gliner-pii-base-v1.0',
    runtime: 'onnx',
    required: false,
    message: 'Place GLiNER PII model and tokenizer for local PII entity detection and redaction.',
    files: [
      {
        path: 'pii/gliner-pii-basemodel.onnx',
        sourceUrl: 'https://huggingface.co/knowledgator/gliner-pii-base-v1.0/resolve/main/onnx/model.onnx',
        fallbackUrls: [
          'https://hf-mirror.com/knowledgator/gliner-pii-base-v1.0/resolve/main/onnx/model.onnx',
        ],
        required: true,
      },
      {
        path: 'pii/tokenizer.json',
        sourceUrl: 'https://huggingface.co/knowledgator/gliner-pii-base-v1.0/resolve/main/tokenizer.json',
        fallbackUrls: [
          'https://hf-mirror.com/knowledgator/gliner-pii-base-v1.0/resolve/main/tokenizer.json',
        ],
        required: true,
      },
    ],
    metadata: { requiredFor: ['pii-redaction'], entities: ['person', 'email', 'phone_number', 'credit_card', 'address', 'api_key', 'ssn', 'ip_address'] },
  },
}

const builtInModelManifests: Record<ModelResourceCategory, ModelResourceManifest> = z.record(
  ModelResourceCategorySchema,
  ModelResourceManifestSchema,
).parse(rawBuiltInModelManifests)

export interface TimelineEntry {
  id: string
  sourceType: 'snapshot' | 'message' | 'audio'
  capturedAt: string
  capturedAtUnix: number
  displayId: number
  segmentDir: string
  framePath: string
  ocrText: string | null
  appBundleId: string | null
  windowTitle: string | null
  platform?: 'slack' | 'audio' | null
  channelId?: string | null
  channelName?: string | null
  userName?: string | null
}

export interface MemoryEntry {
  id: string
  type: '10min' | '6h'
  source: 'llm' | 'local' | 'imported'
  createdAt: string
  createdAtUnix: number
  content: string
  modelId: string | null
  matchKind: 'keyword' | 'semantic' | 'hybrid' | null
  keywordScore: number | null
  semanticScore: number | null
}

export interface ChronicleMemoryUpdateInput {
  content?: string
  metadata?: Record<string, unknown>
  sourceSnapshotPaths?: string[]
  sourceFramePaths?: string[]
}

export interface PrivacyEntity {
  type: string
  start: number
  end: number
  text: string
}

export interface PrivacyRedactionResult {
  text: string
  redactedText: string
  entityCount: number
  entities: PrivacyEntity[]
}

export interface PrivacyExportSource {
  type: string
  id: string
  title: string
  redactedEntityCount: number
}

export interface PrivacyExportResult {
  format: 'markdown' | 'json'
  content: string
  entityCount: number
  sources: PrivacyExportSource[]
}

export interface PrivacyBreadcrumbEntry {
  id: string
  kind: string
  status: 'info' | 'success' | 'warning' | 'error'
  message: string
  snapshotId: string | null
  memoryId: string | null
  attrs: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
}

export type ChronicleRealtimeChannel
  = | 'activity'
    | 'cron'
    | 'meeting'
    | 'memory'
    | 'notification'
    | 'error'
    | 'message'
    | 'audio'
    | 'snapshot'
    | 'model'

export interface ChronicleRealtimeEventEntry {
  id: string
  channel: ChronicleRealtimeChannel
  event: string
  type: 'config' | 'daemon' | 'snapshot' | 'memory' | 'summarize' | 'model-resource' | 'message' | 'audio' | 'activity'
  status: 'info' | 'success' | 'warning' | 'error'
  message: string
  snapshotId: string | null
  memoryId: string | null
  attrs: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
}

export interface ChronicleSnapshotIgnoredResponse {
  status: 'ignored'
  reason: string
  sourceId: string
  capturedAt: string
  capturedAtUnix: number
}

export interface EmbeddingRequestInput {
  texts: string[]
}

export interface EmbeddingResponse {
  modelId: string
  modelVersion: string
  dimensions: number
  embeddings: number[][]
}

export interface ChronicleStatus {
  available: boolean
  running: boolean
  pid: number | null
  lastCaptureAt: number | null
  lastSummaryAt: number | null
  lastErrorAt: number | null
  lastError: string | null
  lastExitCode: number | null
  lastExitAt: number | null
  totalSnapshots: number
  totalSummaries: number
  totalMessages: number
  lastMessageAt: number | null
  totalAccessibilitySnapshots: number
  lastAccessibilitySnapshotAt: number | null
  totalAccessibilityEvents: number
  lastAccessibilityEventAt: number | null
  totalAudioTranscripts: number
  lastAudioTranscriptAt: number | null
  totalAudioRawSegments: number
  lastAudioRawSegmentAt: number | null
  totalActivitySegments: number
  lastActivitySegmentAt: number | null
  totalPipelineRuns: number
  lastPipelineRunAt: number | null
  totalKnowledgeCards: number
  lastKnowledgeCardAt: number | null
  totalDreamRuns: number
  lastDreamRunAt: number | null
  dreamSchedulerEnabled: boolean
  dreamSchedulerRunning: boolean
  dreamSchedulerIntervalMs: number
  dreamSchedulerApplyMerge: boolean
  activityPipelineEnabled: boolean
  activityPipelineRunning: boolean
  activityPipelineIntervalMs: number
  activityPipelineBatchSize: number
  audioCaptureEnabled: boolean
  audioSource: 'microphone' | 'system' | 'mixed'
  audioRuntimeStatus: 'disabled' | 'armed' | 'unavailable'
  closedEyesDiscardEnabled: boolean
  closedEyesMode: 'auto' | 'always-record' | 'always-pause'
  configuredModel: string | null
}

export interface ActivityMonitorStatusEntry {
  enabled: boolean
  available: boolean
  running: boolean
  pid: number | null
  monitorStatus: 'disabled' | 'running' | 'unavailable'
  captureStatus: 'idle' | 'capturing' | 'error'
  pipelineStatus: 'disabled' | 'running' | 'idle'
  audioStatus: 'disabled' | 'armed' | 'unavailable'
  lastCaptureAt: string | null
  lastCaptureAtUnix: number | null
  lastActivityAt: string | null
  lastActivityAtUnix: number | null
  lastPipelineRunAt: string | null
  lastPipelineRunAtUnix: number | null
  lastErrorAt: string | null
  lastErrorAtUnix: number | null
  lastError: string | null
  totals: {
    snapshots: number
    activitySessions: number
    activitySegments: number
    pipelineRuns: number
    accessibilitySnapshots: number
    accessibilityEvents: number
    audioTranscripts: number
    audioRawSegments: number
    memories: number
    messages: number
  }
  config: {
    activityPipelineEnabled: boolean
    activityPipelineIntervalMs: number
    activityPipelineBatchSize: number
    audioCaptureEnabled: boolean
    audioSource: 'microphone' | 'system' | 'mixed'
    closedEyesDiscardEnabled: boolean
    closedEyesMode: 'auto' | 'always-record' | 'always-pause'
  }
}

export interface ActivityStorageStatsEntry {
  storageRoot: string
  modelsRoot: string
  storage: {
    exists: boolean
    fileCount: number
    directoryCount: number
    totalBytes: number
  }
  models: {
    exists: boolean
    fileCount: number
    directoryCount: number
    totalBytes: number
  }
  database: {
    snapshots: number
    activitySessions: number
    activitySegments: number
    memories: number
    memoryChunks: number
    knowledgeCards: number
    pipelineRuns: number
    dreamRuns: number
    accessibilitySnapshots: number
    accessibilityEvents: number
    audioTranscripts: number
    audioRawSegments: number
    messages: number
    modelResources: number
  }
}

export interface MemoryStatusEntry {
  available: boolean
  totalMemories: number
  totalChunks: number
  totalKeywords: number
  totalEmbeddings: number
  totalKnowledgeCards: number
  totalKnowledgeVersions: number
  totalActivitySegments: number
  pendingActivitySegments: number
  crystallizedActivitySegments: number
  totalPipelineRuns: number
  lastMemoryAt: string | null
  lastMemoryAtUnix: number | null
  lastKnowledgeCardAt: string | null
  lastKnowledgeCardAtUnix: number | null
  lastPipelineRunAt: string | null
  lastPipelineRunAtUnix: number | null
  searchIndex: {
    chunkCount: number
    keywordCount: number
    embeddingCount: number
    embeddingReadyCount: number
    embeddingPendingCount: number
    embeddingErrorCount: number
  }
  pipeline: {
    activityPipelineEnabled: boolean
    activityPipelineRunning: boolean
    dreamSchedulerEnabled: boolean
    dreamSchedulerRunning: boolean
  }
}

export interface MemoryCrystallizeInput {
  segmentId?: string
}

export interface MemoryCrystallizeEntry {
  status: 'success' | 'error' | 'skipped'
  message: string
  segmentId: string | null
  result: ActivityPipelineActionResult | null
}

export interface ActivitySegmentEntry {
  id: string
  sessionId: string
  startedAt: string
  startedAtUnix: number
  endedAt: string
  endedAtUnix: number
  durationSeconds: number
  segmentType: ActivitySegmentType
  frontApp: string | null
  title: string | null
  summary: string | null
  sourceCounts: Record<string, number>
  sourceRefs: Record<string, string[]>
  pipelineStatus: 'collecting' | 'triaged' | 'summarized' | 'crystallized' | 'error'
  isCrystallized: boolean
  metadata: Record<string, unknown>
}

export interface ActivitySessionEntry {
  id: string
  workspaceId: string | null
  startedAt: string
  startedAtUnix: number
  endedAt: string | null
  endedAtUnix: number | null
  durationSeconds: number | null
  frontApp: string | null
  title: string | null
  segmentCount: number
  snapshotCount: number
  messageCount: number
  audioTranscriptCount: number
  audioRawSegmentCount: number
  accessibilitySnapshotCount: number
  isMeeting: boolean
  meetingTitle: string | null
  metadata: Record<string, unknown>
}

export interface ActivitySessionDetailEntry extends ActivitySessionEntry {
  segments: ActivitySegmentEntry[]
}

export interface ActivitySnapshotEntry {
  id: string
  sourceId: string
  workspaceId: string | null
  capturedAt: string
  capturedAtUnix: number
  displayId: number
  segmentDir: string
  framePath: string
  artifactPath: string | null
  ocrText: string | null
  appBundleId: string | null
  windowTitle: string | null
  metadata: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
  updatedAt: string
  updatedAtUnix: number
}

export interface ActivitySnapshotOcrEntry {
  snapshotId: string
  sourceId: string
  ocrText: string | null
  ocrPath: string | null
  capturedAt: string
  capturedAtUnix: number
}

export interface PipelineRunEntry {
  id: string
  sessionId: string | null
  segmentId: string | null
  trigger: ActivityPipelineTrigger
  stage: 'collection' | 'segmentation' | 'triage' | 'summarization' | 'crystallization'
  status: 'queued' | 'running' | 'success' | 'error' | 'skipped'
  startedAt: string
  startedAtUnix: number
  endedAt: string | null
  endedAtUnix: number | null
  errorMessage: string | null
  snapshotsCount: number
  messagesCount: number
  audioTranscriptsCount: number
  audioRawSegmentsCount: number
  memoriesCount: number
  segmentsCount: number
  segmentIds: string[]
  metadata: Record<string, unknown>
}

export interface ActivityPipelineActionResult {
  segment: ActivitySegmentEntry
  run: PipelineRunEntry
  memoryId: string | null
  knowledgeCards?: KnowledgeCardEntry[]
  status: 'success' | 'error' | 'skipped'
  message: string
}

export interface KnowledgeCardEntry {
  id: string
  title: string
  content: string
  cardType: KnowledgeCardType
  dimension: KnowledgeDimension
  confidence: number
  sourceMemoryIds: string[]
  sourceSegmentIds: string[]
  sourceChunkIds: string[]
  tags: string[]
  contentHash: string
  version: number
  status: KnowledgeCardStatus
  mergedIntoId: string | null
  pinned: boolean
  metadata: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
  updatedAt: string
  updatedAtUnix: number
}

export interface KnowledgeFileEntry {
  id: string
  knowledgeId: string
  source: 'attached' | 'memory' | 'snapshot' | 'activity'
  filename: string
  contentType: string | null
  sizeBytes: number | null
  filePath: string | null
  embedded: boolean
  evidenceType: string | null
  evidenceId: string | null
  metadata: Record<string, unknown>
  createdAt: string | null
  createdAtUnix: number | null
  updatedAt: string | null
  updatedAtUnix: number | null
}

export interface KnowledgeVersionEntry {
  id: string
  knowledgeId: string
  version: number
  title: string
  content: string
  cardType: KnowledgeCardType
  dimension: KnowledgeDimension
  confidence: number
  sourceMemoryIds: string[]
  sourceSegmentIds: string[]
  sourceChunkIds: string[]
  tags: string[]
  metadata: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
}

export interface DreamRunEntry {
  id: string
  workspaceId: string | null
  runType: DreamRunType
  status: DreamRunStatus
  startedAt: string
  startedAtUnix: number
  endedAt: string | null
  endedAtUnix: number | null
  inputCount: number
  outputCount: number
  mergedCount: number
  deletedCount: number
  sourceKnowledgeIds: string[]
  outputKnowledgeIds: string[]
  config: Record<string, unknown>
  result: Record<string, unknown>
  errorMessage: string | null
}

export interface DreamRunInput {
  runType?: DreamStartRunType
  dryRun?: boolean
  limit?: number
  similarityThreshold?: number
  applyMerge?: boolean
  olderThanDays?: number
  knowledgeIds?: string[]
}

export interface KnowledgeCardMutationInput {
  title: string
  content: string
  cardType?: KnowledgeCardType
  dimension?: KnowledgeDimension
  confidence?: number
  sourceMemoryIds?: string[]
  sourceSegmentIds?: string[]
  sourceChunkIds?: string[]
  tags?: string[]
  stableKey?: string
  pinned?: boolean
  metadata?: Record<string, unknown>
}

export interface KnowledgeCardPatchInput extends Partial<KnowledgeCardMutationInput> {
  status?: KnowledgeCardStatus
  mergedIntoId?: string | null
}

export interface MessageSourceEntry {
  id: string
  platform: 'slack'
  label: string
  enabled: boolean
  workspaceId: string | null
  teamId: string | null
  botTokenRef: string | null
  channelIds: string[]
  realtimeMode: SlackRealtimeMode
  signingSecretRef: string | null
  socketAppTokenRef: string | null
  status: 'idle' | 'syncing' | 'ready' | 'error' | 'disabled'
  lastSyncAt: number | null
  lastMessageAt: number | null
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface MessageSourceInput {
  platform: 'slack'
  label: string
  enabled: boolean
  workspaceId?: string | null
  teamId?: string | null
  botTokenRef?: string | null
  channelIds: string[]
  realtimeMode?: SlackConfigurableRealtimeMode
  signingSecretRef?: string | null
  socketAppTokenRef?: string | null
}

export interface MessageSourcePatchInput {
  label?: string
  enabled?: boolean
  workspaceId?: string | null
  teamId?: string | null
  botTokenRef?: string | null
  channelIds?: string[]
  realtimeMode?: SlackConfigurableRealtimeMode
  signingSecretRef?: string | null
  socketAppTokenRef?: string | null
}

export interface MessageEntry {
  id: string
  sourceId: string
  platform: 'slack'
  channelId: string
  channelName: string | null
  userName: string | null
  text: string
  messageTs: string
  messageAt: string
  messageAtUnix: number
  permalink: string | null
}

export interface SlackEventsInput {
  rawBody: string
  signature: string | null
  timestamp: string | null
}

export interface SlackEventsResult {
  sourceId: string
  status: 'ok' | 'ignored'
  ingested: number
  message: string
  challenge?: string
}

export interface AudioTranscriptSegmentInput {
  startMs: number
  endMs?: number | null
  speakerLabel?: string | null
  text: string
  confidence?: number | null
  language?: string | null
  metadata?: Record<string, unknown>
}

export interface AudioTranscriptReportInput {
  sourceId: string
  title?: string | null
  source?: 'asr' | 'manual' | 'imported'
  status?: 'recording' | 'completed' | 'imported' | 'error'
  startedAt: string
  endedAt?: string | null
  language?: string | null
  appBundleId?: string | null
  windowTitle?: string | null
  audioPath?: string | null
  transcriptPath?: string | null
  segments: AudioTranscriptSegmentInput[]
  metadata?: Record<string, unknown>
}

export interface AudioTranscriptSegmentEntry {
  id: string
  segmentIndex: number
  startMs: number
  endMs: number | null
  speakerLabel: string | null
  text: string
  confidence: number | null
  language: string | null
}

export interface AudioTranscriptEntry {
  id: string
  sourceId: string
  memoryId: string | null
  title: string | null
  source: 'asr' | 'manual' | 'imported'
  status: 'recording' | 'completed' | 'imported' | 'error'
  startedAt: string
  startedAtUnix: number
  endedAt: string | null
  endedAtUnix: number | null
  language: string | null
  appBundleId: string | null
  windowTitle: string | null
  segmentCount: number
  previewText: string
  segments: AudioTranscriptSegmentEntry[]
}

export interface SpeakerProfileEntry {
  id: string
  workspaceId: string | null
  displayName: string
  normalizedLabel: string
  aliases: string[]
  embedding: number[] | null
  embeddingDimensions: number | null
  embeddingModelId: string | null
  sampleCount: number
  lastSeenAt: string | null
  lastSeenAtUnix: number | null
  sourceTranscriptId: string | null
  sourceSegmentId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
  updatedAt: string
  updatedAtUnix: number
}

export interface SpeakerProfileInput {
  displayName: string
  aliases?: string[]
  embedding?: number[] | null
  embeddingModelId?: string | null
  sampleCount?: number
  lastSeenAt?: string | null
  metadata?: Record<string, unknown>
}

export interface AudioRawSegmentReportInput {
  sourceId: string
  recordedAt: string
  source?: 'microphone' | 'system' | 'mixed'
  status?: 'captured' | 'queued' | 'processed' | 'ignored' | 'error'
  audioPath: string
  metadataPath: string
  sampleRate: number
  channels: number
  sampleCount: number
  droppedSamples?: number
  durationMs?: number
  rms: number
  peak: number
  active: boolean
  vadImplemented?: boolean
  asrImplemented?: boolean
  speakerLabelingImplemented?: boolean
  metadata?: Record<string, unknown>
}

export interface AudioRawSegmentProcessingResultInput {
  status?: 'captured' | 'queued' | 'processed' | 'ignored' | 'error'
  vadStatus?: AudioProcessingStatus
  asrStatus?: AudioProcessingStatus
  speakerStatus?: AudioProcessingStatus
  transcriptSourceId?: string | null
  speakerProfileIds?: string[]
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

export interface AudioRawSegmentEntry {
  id: string
  sourceId: string
  recordedAt: string
  recordedAtUnix: number
  source: 'microphone' | 'system' | 'mixed'
  status: 'captured' | 'queued' | 'processed' | 'ignored' | 'error'
  audioPath: string
  metadataPath: string
  sampleRate: number
  channels: number
  sampleCount: number
  droppedSamples: number
  durationMs: number
  rms: number
  peak: number
  active: boolean
  vadStatus: AudioProcessingStatus
  asrStatus: AudioProcessingStatus
  speakerStatus: AudioProcessingStatus
  metadata: Record<string, unknown>
}

export interface AccessibilitySnapshotReportInput {
  sourceId: string
  status?: 'ready' | 'permission-denied' | 'unavailable' | 'error'
  provider?: string
  accessibilityPath?: string | null
  text?: string | null
  elementCount?: number
  appBundleId?: string | null
  windowTitle?: string | null
  tree?: unknown[]
  metadata?: Record<string, unknown>
}

export interface AccessibilitySnapshotEntry {
  id: string
  sourceId: string
  snapshotId: string | null
  capturedAt: string
  capturedAtUnix: number
  status: 'ready' | 'permission-denied' | 'unavailable' | 'error'
  provider: string
  appBundleId: string | null
  windowTitle: string | null
  elementCount: number
  text: string | null
  tree: unknown[]
  metadata: Record<string, unknown>
}

export interface AccessibilityEventReportInput {
  sourceId: string
  capturedAt: string
  provider?: string
  appBundleId?: string | null
  pid?: number | null
  notification: string
  droppedBefore?: number
  snapshotId?: string | null
  accessibilitySnapshotId?: string | null
  metadata?: Record<string, unknown>
}

export interface AccessibilityEventEntry {
  id: string
  sourceId: string
  snapshotId: string | null
  accessibilitySnapshotId: string | null
  capturedAt: string
  capturedAtUnix: number
  provider: string
  appBundleId: string | null
  pid: number | null
  notification: string
  droppedBefore: number
  metadata: Record<string, unknown>
}

export interface ChronicleSnapshotReportInput {
  sourceId: string
  displayId: number
  frameIndex?: number
  capturedAt: string
  segmentDir: string
  framePath: string
  capturePath?: string
  ocrPath?: string
  snapshotPath?: string
  ocrText?: string
  appBundleId?: string
  windowTitle?: string
  closedEyes?: {
    status?: 'open' | 'closed' | 'absent' | 'unknown'
    confidence?: number | null
    detector?: string | null
    discard?: boolean | null
    reason?: string | null
    metadata?: Record<string, unknown>
  }
  accessibility?: AccessibilitySnapshotReportInput
  metadata?: Record<string, unknown>
}

export interface ChronicleMemoryReportInput {
  sourceId: string
  windowType: '10min' | '6h'
  createdAt: string
  memoryPath?: string
  content: string
  summaryKind: 'llm' | 'local' | 'imported'
  sourceSnapshotPaths?: string[]
  sourceFramePaths?: string[]
  metadata?: Record<string, unknown>
}

function getConfigPath(): string {
  const config = getServerConfig()
  const baseDir = config.dataDir ?? dirname(config.dbPath)
  return resolve(baseDir, 'preferences', 'chronicle.json')
}

export function isChronicleRuntimeAllowed(): boolean {
  return process.env.NODE_ENV !== 'production'
}

function assertChronicleRuntimeAllowed(): void {
  if (isChronicleRuntimeAllowed()) {
    return
  }
  throw new AppError({
    code: 'chronicle_runtime_disabled',
    status: 403,
    message: CHRONICLE_PRODUCTION_DISABLED_MESSAGE,
    details: { nodeEnv: process.env.NODE_ENV ?? null },
  })
}

export async function getConfig(): Promise<ChronicleConfig> {
  const filePath = getConfigPath()
  if (!existsSync(filePath)) {
    return ChronicleConfigSchema.parse({})
  }
  const content = await readFile(filePath, 'utf8')
  return ChronicleConfigJsonSchema.parse(content)
}

async function saveConfig(config: ChronicleConfig): Promise<void> {
  const filePath = getConfigPath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(config, null, 2), 'utf8')
}

function toDaemonOptions(config: ChronicleConfig): DaemonManager.ChronicleDaemonOptions {
  return {
    storageRoot: config.storageRoot,
    audioCaptureEnabled: config.audioCaptureEnabled,
    audioSource: config.audioSource,
    audioSegmentMs: config.audioSegmentMs,
    audioSegmentIntervalMs: config.audioSegmentIntervalMs,
    audioRmsThreshold: config.audioRmsThreshold,
    privacySensitiveAppBundleIds: config.privacySensitiveAppBundleIds,
    privacySensitiveTitlePatterns: config.privacySensitiveTitlePatterns,
    privacySensitiveUrlPatterns: config.privacySensitiveUrlPatterns,
  }
}

function daemonLaunchConfigChanged(previous: ChronicleConfig, next: ChronicleConfig): boolean {
  return previous.storageRoot !== next.storageRoot
    || previous.audioCaptureEnabled !== next.audioCaptureEnabled
    || previous.audioSource !== next.audioSource
    || previous.audioSegmentMs !== next.audioSegmentMs
    || previous.audioSegmentIntervalMs !== next.audioSegmentIntervalMs
    || previous.audioRmsThreshold !== next.audioRmsThreshold
    || stringArraysDiffer(previous.privacySensitiveAppBundleIds, next.privacySensitiveAppBundleIds)
    || stringArraysDiffer(previous.privacySensitiveTitlePatterns, next.privacySensitiveTitlePatterns)
    || stringArraysDiffer(previous.privacySensitiveUrlPatterns, next.privacySensitiveUrlPatterns)
}

function stringArraysDiffer(previous: string[], next: string[]): boolean {
  return previous.length !== next.length || previous.some((value, index) => value !== next[index])
}

function getAudioRuntimeStatus(
  config: ChronicleConfig,
  daemonInfo: ReturnType<typeof DaemonManager.getDaemonInfo>,
): ChronicleStatus['audioRuntimeStatus'] {
  if (!config.enabled || !config.audioCaptureEnabled) {
    return 'disabled'
  }
  return daemonInfo.running && daemonInfo.audioCaptureEnabled ? 'armed' : 'unavailable'
}

async function generateChronicleText(input: {
  modelContext: ChronicleLanguageModelContext
  prompt: string
  stage: ChronicleGenerateStage
}): Promise<ChronicleGenerateTextResult> {
  const maxAttempts = ChronicleModelGenerateMaxAttemptsSchema.parse(process.env.CRADLE_CHRONICLE_MODEL_GENERATE_MAX_ATTEMPTS)
  const baseDelayMs = ChronicleModelGenerateBaseDelayMsSchema.parse(process.env.CRADLE_CHRONICLE_MODEL_GENERATE_BASE_DELAY_MS)
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await generateText({
        model: input.modelContext.model,
        prompt: input.prompt,
        maxRetries: 0,
        timeout: CHRONICLE_MODEL_GENERATE_TIMEOUT_MS,
      })
    }
    catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= maxAttempts || !isRetryableChronicleModelError(message)) {
        throw error
      }

      recordEvent({
        type: input.stage === 'summarize' ? 'summarize' : 'activity',
        status: 'warning',
        message: `Chronicle model generation retry ${attempt}/${maxAttempts}: ${message}`,
        attrs: {
          stage: input.stage,
          attempt,
          maxAttempts,
          modelId: input.modelContext.modelId,
          profileId: input.modelContext.profileId,
        },
      })
      await delayChronicleModelRetry(attempt, baseDelayMs)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function isRetryableChronicleModelError(message: string): boolean {
  const normalized = message.toLowerCase()
  return [
    'invalid json response',
    'failed to parse json',
    'unexpected token',
    'json response body',
    'fetch failed',
    'econnreset',
    'econnrefused',
    'etimedout',
    'enotfound',
    'network',
    'timeout',
    'rate limit',
    'temporarily unavailable',
    '429',
    '500',
    '502',
    '503',
    '504',
  ].some(pattern => normalized.includes(pattern))
}

async function delayChronicleModelRetry(attempt: number, baseDelayMs: number): Promise<void> {
  const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), CHRONICLE_MODEL_GENERATE_MAX_DELAY_MS)
  if (delayMs <= 0) {
    return
  }
  await new Promise(resolve => setTimeout(resolve, delayMs))
}

export async function updateConfig(input: unknown): Promise<ChronicleConfig> {
  const config = ChronicleConfigSchema.parse(input)
  if (config.enabled) {
    assertChronicleRuntimeAllowed()
  }
  const previous = await getConfig()
  const next = {
    ...config,
    activityPipelineIntervalMs: boundedNumber(config.activityPipelineIntervalMs, ACTIVITY_PIPELINE_MIN_INTERVAL_MS, ACTIVITY_PIPELINE_MAX_INTERVAL_MS),
    activityPipelineBatchSize: Math.floor(boundedNumber(config.activityPipelineBatchSize, ACTIVITY_PIPELINE_MIN_BATCH_SIZE, ACTIVITY_PIPELINE_MAX_BATCH_SIZE)),
    dreamSchedulerIntervalMs: boundedNumber(config.dreamSchedulerIntervalMs, DREAM_SCHEDULER_MIN_INTERVAL_MS, DREAM_SCHEDULER_MAX_INTERVAL_MS),
    audioSegmentMs: boundedNumber(config.audioSegmentMs, 100, 30_000),
    audioSegmentIntervalMs: boundedNumber(config.audioSegmentIntervalMs, 100, 3_600_000),
    audioRmsThreshold: boundedNumber(config.audioRmsThreshold, 0, 1),
    storageRoot: resolve(config.storageRoot),
    audioSource: config.audioSource,
  }
  await saveConfig(next)
  recordEvent({
    type: 'config',
    status: 'success',
    message: next.enabled ? 'Chronicle enabled' : 'Chronicle disabled',
    attrs: {
      storageRoot: next.storageRoot,
      profileId: next.profileId,
      modelId: next.modelId,
      activityPipelineEnabled: next.activityPipelineEnabled,
      activityPipelineIntervalMs: next.activityPipelineIntervalMs,
      activityPipelineBatchSize: next.activityPipelineBatchSize,
      dreamSchedulerEnabled: next.dreamSchedulerEnabled,
      dreamSchedulerIntervalMs: next.dreamSchedulerIntervalMs,
      dreamSchedulerApplyMerge: next.dreamSchedulerApplyMerge,
      audioCaptureEnabled: next.audioCaptureEnabled,
      audioSource: next.audioSource,
      audioSegmentMs: next.audioSegmentMs,
      audioSegmentIntervalMs: next.audioSegmentIntervalMs,
      audioRmsThreshold: next.audioRmsThreshold,
    },
  })

  if (next.enabled && !previous.enabled) {
    const started = DaemonManager.startDaemon(toDaemonOptions(next))
    recordEvent({
      type: 'daemon',
      status: started ? 'success' : 'error',
      message: started ? 'Chronicle daemon start requested' : 'Chronicle daemon failed to start',
    })
  }
  else if (next.enabled && daemonLaunchConfigChanged(previous, next)) {
    const started = DaemonManager.restartDaemon(toDaemonOptions(next))
    recordEvent({
      type: 'daemon',
      status: started ? 'success' : 'error',
      message: started ? 'Chronicle daemon restart requested' : 'Chronicle daemon failed to restart',
    })
  }
  else if (!next.enabled && previous.enabled) {
    DaemonManager.stopDaemon()
    recordEvent({ type: 'daemon', status: 'success', message: 'Chronicle daemon stop requested' })
  }

  restartActivityPipelineScheduler(next)
  restartDreamScheduler(next)

  return next
}

export async function summarize(rawBody: z.input<typeof ChronicleSummarizeInputSchema>): Promise<{ summary: string, memoryId: string | null, status: 'success' | 'error' }> {
  const body = ChronicleSummarizeInputSchema.parse(rawBody)
  const config = await getConfig()
  const modelContextResult = resolveChronicleLanguageModelContext(config)
  if (!modelContextResult.ok) {
    recordEvent({ type: 'summarize', status: 'error', message: modelContextResult.message })
    return { summary: `[Chronicle error - ${modelContextResult.message}]`, memoryId: null, status: 'error' }
  }
  const modelContext = modelContextResult.context

  try {
    const result = await generateChronicleText({
      modelContext,
      prompt: body.prompt,
      stage: 'summarize',
    })
    const usage = normalizeLanguageModelUsage(result.usage)
    const memory = recordMemory({
      sourceId: `summary:${Date.now()}:${randomUUID()}`,
      windowType: body.windowType,
      createdAt: new Date().toISOString(),
      content: result.text,
      summaryKind: 'llm',
      sourceSnapshotPaths: body.sourceArtifactPaths,
      metadata: { prompt: body.prompt },
    }, {
      prompt: body.prompt,
      modelId: modelContext.modelId,
      profileId: modelContext.profileId,
      usage,
      sourceSnapshotIds: body.sourceSnapshotIds,
    })
    recordEvent({
      type: 'summarize',
      status: 'success',
      message: 'Chronicle summary generated',
      memoryId: memory.id,
      attrs: { modelId: modelContext.modelId, profileId: modelContext.profileId, usage },
    })
    return { summary: result.text, memoryId: memory.id, status: 'success' }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordEvent({
      type: 'summarize',
      status: 'error',
      message,
      attrs: { modelId: modelContext.modelId, profileId: modelContext.profileId },
    })
    return { summary: `[Chronicle error - ${message}]`, memoryId: null, status: 'error' }
  }
}

function resolveChronicleLanguageModelContext(config: ChronicleConfig): ChronicleLanguageModelContextResult {
  const failure = validateSummaryConfig(config)
  if (failure) {
    return { ok: false, message: failure }
  }

  const providerTarget = ProviderTargets.resolveProviderTarget(config.profileId)
  const parsedConfig = ProfileConfigJsonSchema.parse(providerTarget.configJson)
  const apiKey = resolveProfileApiKey(providerTarget.credentialRef, parsedConfig.apiKey)
  if (!apiKey) {
    return { ok: false, message: 'no API key available for provider target' }
  }

  const modelId = config.modelId || parsedConfig.modelId || parsedConfig.model || 'gpt-4o-mini'
  const apiFormat = detectApiFormat(parsedConfig.baseUrl)
  const model = createLanguageModel({
    apiFormat,
    apiKey,
    baseUrl: parsedConfig.baseUrl,
    modelId,
    apiMode: parsedConfig.apiMode,
  })
  return { ok: true, context: { model, modelId, profileId: config.profileId } }
}

function normalizeLanguageModelUsage(usage: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
} | undefined): { promptTokens: number, completionTokens: number, totalTokens: number } {
  const promptTokens = usage?.inputTokens ?? 0
  const completionTokens = usage?.outputTokens ?? 0
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage?.totalTokens ?? promptTokens + completionTokens,
  }
}

export async function getStatus(): Promise<ChronicleStatus> {
  const config = await getConfig()
  const runtimeAllowed = isChronicleRuntimeAllowed()
  const runtimeEnabled = runtimeAllowed && config.enabled
  const daemonInfo = DaemonManager.getDaemonInfo()
  const latestSnapshot = db().select().from(chronicleSnapshots).orderBy(desc(chronicleSnapshots.capturedAt)).limit(1).get()
  const latestMemory = db().select().from(chronicleMemories).orderBy(desc(chronicleMemories.createdAt)).limit(1).get()
  const latestError = db().select().from(chronicleEvents).where(eq(chronicleEvents.status, 'error')).orderBy(desc(chronicleEvents.createdAt)).limit(1).get()
  const snapshotCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_snapshots`)?.count ?? 0
  const memoryCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_memories`)?.count ?? 0
  const accessibilitySnapshotCount = db()
    .select({ value: count() })
    .from(chronicleAccessibilitySnapshots)
    .get()
?.value ?? 0
  const accessibilityEventCount = db()
    .select({ value: count() })
    .from(chronicleAccessibilityEvents)
    .get()
?.value ?? 0
  const audioTranscriptCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_audio_transcripts`)?.count ?? 0
  const audioRawSegmentCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_audio_raw_segments`)?.count ?? 0
  const activitySegmentCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_activity_segments`)?.count ?? 0
  const pipelineRunCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_pipeline_runs`)?.count ?? 0
  const knowledgeCardCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_knowledge_cards WHERE status != 'deleted'`)?.count ?? 0
  const dreamRunCount = db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_dream_runs`)?.count ?? 0

  return {
    available: runtimeEnabled && !!config.profileId,
    running: runtimeEnabled && daemonInfo.running,
    pid: daemonInfo.pid,
    lastCaptureAt: latestSnapshot?.capturedAt ?? null,
    lastSummaryAt: latestMemory?.createdAt ?? null,
    lastErrorAt: latestError?.createdAt ?? null,
    lastError: latestError?.message ?? null,
    lastExitCode: daemonInfo.lastExitCode,
    lastExitAt: daemonInfo.lastExitAt,
    totalSnapshots: snapshotCount,
    totalSummaries: memoryCount,
    totalMessages: db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_messages`)?.count ?? 0,
    lastMessageAt: db().select({ messageAt: chronicleMessages.messageAt }).from(chronicleMessages).orderBy(desc(chronicleMessages.messageAt)).limit(1).get()?.messageAt ?? null,
    totalAccessibilitySnapshots: accessibilitySnapshotCount,
    lastAccessibilitySnapshotAt: db().select({ capturedAt: chronicleAccessibilitySnapshots.capturedAt }).from(chronicleAccessibilitySnapshots).orderBy(desc(chronicleAccessibilitySnapshots.capturedAt)).limit(1).get()?.capturedAt ?? null,
    totalAccessibilityEvents: accessibilityEventCount,
    lastAccessibilityEventAt: db().select({ capturedAt: chronicleAccessibilityEvents.capturedAt }).from(chronicleAccessibilityEvents).orderBy(desc(chronicleAccessibilityEvents.capturedAt)).limit(1).get()?.capturedAt ?? null,
    totalAudioTranscripts: audioTranscriptCount,
    lastAudioTranscriptAt: db().select({ startedAt: chronicleAudioTranscripts.startedAt }).from(chronicleAudioTranscripts).orderBy(desc(chronicleAudioTranscripts.startedAt)).limit(1).get()?.startedAt ?? null,
    totalAudioRawSegments: audioRawSegmentCount,
    lastAudioRawSegmentAt: db().select({ recordedAt: chronicleAudioRawSegments.recordedAt }).from(chronicleAudioRawSegments).orderBy(desc(chronicleAudioRawSegments.recordedAt)).limit(1).get()?.recordedAt ?? null,
    totalActivitySegments: activitySegmentCount,
    lastActivitySegmentAt: db().select({ startedAt: chronicleActivitySegments.startedAt }).from(chronicleActivitySegments).orderBy(desc(chronicleActivitySegments.startedAt)).limit(1).get()?.startedAt ?? null,
    totalPipelineRuns: pipelineRunCount,
    lastPipelineRunAt: db().select({ startedAt: chroniclePipelineRuns.startedAt }).from(chroniclePipelineRuns).orderBy(desc(chroniclePipelineRuns.startedAt)).limit(1).get()?.startedAt ?? null,
    totalKnowledgeCards: knowledgeCardCount,
    lastKnowledgeCardAt: db().select({ updatedAt: chronicleKnowledgeCards.updatedAt }).from(chronicleKnowledgeCards).orderBy(desc(chronicleKnowledgeCards.updatedAt)).limit(1).get()?.updatedAt ?? null,
    totalDreamRuns: dreamRunCount,
    lastDreamRunAt: db().select({ startedAt: chronicleDreamRuns.startedAt }).from(chronicleDreamRuns).orderBy(desc(chronicleDreamRuns.startedAt)).limit(1).get()?.startedAt ?? null,
    dreamSchedulerEnabled: runtimeEnabled && config.dreamSchedulerEnabled,
    dreamSchedulerRunning: runtimeEnabled && dreamSchedulerRunning,
    dreamSchedulerIntervalMs: config.dreamSchedulerIntervalMs,
    dreamSchedulerApplyMerge: config.dreamSchedulerApplyMerge,
    activityPipelineEnabled: runtimeEnabled && config.activityPipelineEnabled,
    activityPipelineRunning: runtimeEnabled && activityPipelineRunning,
    activityPipelineIntervalMs: config.activityPipelineIntervalMs,
    activityPipelineBatchSize: config.activityPipelineBatchSize,
    audioCaptureEnabled: config.audioCaptureEnabled,
    audioSource: config.audioSource,
    audioRuntimeStatus: runtimeAllowed ? getAudioRuntimeStatus(config, daemonInfo) : 'disabled',
    closedEyesDiscardEnabled: config.closedEyesDiscardEnabled,
    closedEyesMode: config.closedEyesMode,
    configuredModel: await getConfiguredModel(config),
  }
}

export async function initDaemon(): Promise<void> {
  if (!isChronicleRuntimeAllowed()) {
    DaemonManager.stopDaemon()
    stopActivityPipelineScheduler()
    stopDreamScheduler()
    return
  }
  const config = await getConfig()
  if (config.enabled) {
    DaemonManager.startDaemon(toDaemonOptions(config))
  }
  restartActivityPipelineScheduler(config)
  restartDreamScheduler(config)
}

export function startSlackBackgroundSync(): void {
  if (!isChronicleRuntimeAllowed()) {
    stopSlackBackgroundSync()
    return
  }
  if (slackSyncTimer) {
    return
  }

  void runSlackSyncTick().catch((error) => {
    console.error('[chronicle] Slack background sync failed:', error)
  })
  slackSyncTimer = setInterval(() => {
    void runSlackSyncTick().catch((error) => {
      console.error('[chronicle] Slack background sync failed:', error)
    })
  }, SLACK_SYNC_INTERVAL_MS)
}

export function stopSlackBackgroundSync(): void {
  if (!slackSyncTimer) {
    return
  }

  clearInterval(slackSyncTimer)
  slackSyncTimer = null
  slackSyncRunning = false
  activeSlackSyncs.clear()
}

export function stopActivityPipelineScheduler(): void {
  if (!activityPipelineTimer) {
    return
  }
  clearInterval(activityPipelineTimer)
  activityPipelineTimer = null
  activityPipelineRunning = false
}

export function stopDreamScheduler(): void {
  if (!dreamSchedulerTimer) {
    return
  }
  clearInterval(dreamSchedulerTimer)
  dreamSchedulerTimer = null
  dreamSchedulerRunning = false
}

export function restartActivityPipelineScheduler(config: ChronicleConfig): void {
  stopActivityPipelineScheduler()
  if (!isChronicleRuntimeAllowed() || !config.enabled || !config.activityPipelineEnabled) {
    return
  }
  void runActivityPipelineTick().catch((error) => {
    console.error('[chronicle] Activity pipeline tick failed:', error)
  })
  activityPipelineTimer = setInterval(() => {
    void runActivityPipelineTick().catch((error) => {
      console.error('[chronicle] Activity pipeline tick failed:', error)
    })
  }, config.activityPipelineIntervalMs)
}

export function restartDreamScheduler(config: ChronicleConfig): void {
  stopDreamScheduler()
  if (!isChronicleRuntimeAllowed() || !config.enabled || !config.dreamSchedulerEnabled) {
    return
  }
  dreamSchedulerTimer = setInterval(() => {
    void runDreamSchedulerTick().catch((error) => {
      console.error('[chronicle] Dream scheduler tick failed:', error)
    })
  }, config.dreamSchedulerIntervalMs)
}

export async function runDreamSchedulerTick(): Promise<DreamRunEntry | null> {
  if (!isChronicleRuntimeAllowed()) {
    return null
  }
  if (dreamSchedulerRunning) {
    return null
  }

  dreamSchedulerRunning = true
  try {
    const config = await getConfig()
    if (!config.enabled || !config.dreamSchedulerEnabled) {
      return null
    }
    return startDreamRun({
      dryRun: !config.dreamSchedulerApplyMerge,
      applyMerge: config.dreamSchedulerApplyMerge,
    })
  }
  finally {
    dreamSchedulerRunning = false
  }
}

export async function runActivityPipelineTick(): Promise<{
  checked: number
  triaged: number
  summarized: number
  crystallized: number
  skipped: number
  errors: number
}> {
  if (!isChronicleRuntimeAllowed()) {
    return { checked: 0, triaged: 0, summarized: 0, crystallized: 0, skipped: 0, errors: 0 }
  }
  if (activityPipelineRunning) {
    return { checked: 0, triaged: 0, summarized: 0, crystallized: 0, skipped: 0, errors: 0 }
  }

  activityPipelineRunning = true
  try {
    const config = await getConfig()
    if (!config.enabled || !config.activityPipelineEnabled) {
      return { checked: 0, triaged: 0, summarized: 0, crystallized: 0, skipped: 0, errors: 0 }
    }
    const segments = db()
      .select()
      .from(chronicleActivitySegments)
      .where(sql`${chronicleActivitySegments.pipelineStatus} IN ('collecting', 'triaged', 'summarized', 'error') AND ${chronicleActivitySegments.isCrystallized} = 0`)
      .orderBy(chronicleActivitySegments.startedAt)
      .limit(config.activityPipelineBatchSize)
      .all()
    let triaged = 0
    let summarized = 0
    let crystallized = 0
    let skipped = 0
    let errors = 0
    for (const segment of segments) {
      try {
        const result = await advanceActivitySegmentPipeline(segment.id)
        if (result.status === 'error') {
          errors += 1
        }
        else if (result.status === 'skipped') {
          skipped += 1
        }
        if (result.run.stage === 'triage') {
          triaged += 1
        }
        else if (result.run.stage === 'summarization') {
          summarized += 1
        }
        else if (result.run.stage === 'crystallization') {
          crystallized += 1
        }
      }
      catch (error) {
        errors += 1
        recordEvent({
          type: 'activity',
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
          attrs: { segmentId: segment.id, stage: 'activity-pipeline-scheduler' },
        })
      }
    }
    return { checked: segments.length, triaged, summarized, crystallized, skipped, errors }
  }
  finally {
    activityPipelineRunning = false
  }
}

async function advanceActivitySegmentPipeline(segmentId: string): Promise<ActivityPipelineActionResult> {
  const segment = db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()
  if (!segment) {
    throw new AppError({ code: 'chronicle_activity_segment_not_found', status: 404, message: 'Chronicle activity segment not found' })
  }
  if (segment.pipelineStatus === 'collecting' || segment.pipelineStatus === 'error') {
    return triageActivitySegment(segmentId)
  }
  if (segment.pipelineStatus === 'triaged') {
    return summarizeActivitySegment(segmentId)
  }
  return crystallizeActivitySegment(segmentId)
}

export async function runSlackSyncTick(): Promise<{ checked: number, synced: number, errors: number }> {
  if (!isChronicleRuntimeAllowed()) {
    return { checked: 0, synced: 0, errors: 0 }
  }
  if (slackSyncRunning) {
    return { checked: 0, synced: 0, errors: 0 }
  }

  slackSyncRunning = true
  try {
    const sources = db()
      .select({ id: chronicleMessageSources.id })
      .from(chronicleMessageSources)
      .where(sql`${chronicleMessageSources.platform} = 'slack' AND ${chronicleMessageSources.enabled} = 1`)
      .all()

    let synced = 0
    let errors = 0
    for (const source of sources) {
      const result = await syncSlackSource(source.id, 'background')
      if (result.status === 'success') {
        synced += 1
      }
      else {
        errors += 1
      }
    }

    return { checked: sources.length, synced, errors }
  }
  finally {
    slackSyncRunning = false
  }
}

export function getTimeline(limit = 50): TimelineEntry[] {
  const snapshots = db()
    .select()
    .from(chronicleSnapshots)
    .orderBy(desc(chronicleSnapshots.capturedAt))
    .limit(limit)
    .all()
    .map(row => ({
      id: row.id,
      sourceType: 'snapshot' as const,
      capturedAt: new Date(row.capturedAt * 1000).toISOString(),
      capturedAtUnix: row.capturedAt,
      displayId: row.displayId,
      segmentDir: row.segmentDir,
      framePath: row.framePath,
      ocrText: row.ocrText,
      appBundleId: row.appBundleId,
      windowTitle: row.windowTitle,
    }))
  const messages = db()
    .select()
    .from(chronicleMessages)
    .orderBy(desc(chronicleMessages.messageAt))
    .limit(limit)
    .all()
    .map(row => ({
      id: row.id,
      sourceType: 'message' as const,
      capturedAt: new Date(row.messageAt * 1000).toISOString(),
      capturedAtUnix: row.messageAt,
      displayId: 0,
      segmentDir: '',
      framePath: '',
      ocrText: row.text,
      appBundleId: 'slack',
      windowTitle: row.channelName ?? row.channelId,
      platform: row.platform,
      channelId: row.channelId,
      channelName: row.channelName,
      userName: row.userName,
    }))
  const audioTranscripts = db()
    .select()
    .from(chronicleAudioTranscripts)
    .orderBy(desc(chronicleAudioTranscripts.startedAt))
    .limit(limit)
    .all()
    .map(row => ({
      id: row.id,
      sourceType: 'audio' as const,
      capturedAt: new Date(row.startedAt * 1000).toISOString(),
      capturedAtUnix: row.startedAt,
      displayId: 0,
      segmentDir: '',
      framePath: '',
      ocrText: buildAudioTranscriptPreview(row.id),
      appBundleId: row.appBundleId ?? 'audio',
      windowTitle: row.title ?? row.windowTitle ?? 'Audio transcript',
      platform: 'audio' as const,
      channelId: null,
      channelName: row.title,
      userName: null,
    }))

  return [...snapshots, ...messages, ...audioTranscripts]
    .sort((left, right) => right.capturedAtUnix - left.capturedAtUnix)
    .slice(0, limit)
}

export function getMemories(limit = 20): MemoryEntry[] {
  return db()
    .select()
    .from(chronicleMemories)
    .orderBy(desc(chronicleMemories.createdAt))
    .limit(limit)
    .all()
    .map(row => toMemoryEntry(row))
}

export function getMemory(memoryId: string): MemoryEntry {
  const row = db()
    .select()
    .from(chronicleMemories)
    .where(eq(chronicleMemories.id, memoryId))
    .get()
  if (!row) {
    throw new AppError({ code: 'chronicle_memory_not_found', status: 404, message: 'Chronicle memory not found' })
  }
  return toMemoryEntry(row)
}

export function updateMemory(memoryId: string, rawInput: ChronicleMemoryUpdateInput): MemoryEntry {
  const input = ChronicleMemoryUpdateInputSchema.parse(rawInput)
  const existing = db().select().from(chronicleMemories).where(eq(chronicleMemories.id, memoryId)).get()
  if (!existing) {
    throw new AppError({ code: 'chronicle_memory_not_found', status: 404, message: 'Chronicle memory not found' })
  }
  const config = syncConfig()
  const now = currentUnixSeconds()
  const content = input.content ?? existing.content
  const contentHash = hashText(canonicalizeMemoryContent(content))
  const sourceSnapshotPaths = input.sourceSnapshotPaths === undefined ? [] : input.sourceSnapshotPaths
  const sourceFramePaths = input.sourceFramePaths === undefined ? [] : input.sourceFramePaths
  const sourcePaths = input.sourceSnapshotPaths || input.sourceFramePaths
    ? uniqueStrings([
        ...StringListTextSchema.parse(existing.sourcePathsJson),
        ...sourceSnapshotPaths.map(path => toRootRelative(config.storageRoot, path)),
        ...sourceFramePaths.map(path => toRootRelative(config.storageRoot, path)),
      ])
    : StringListTextSchema.parse(existing.sourcePathsJson)
  const sourceSnapshotIds = input.sourceSnapshotPaths
    ? uniqueStrings([
        ...StringListTextSchema.parse(existing.sourceSnapshotIdsJson),
        ...findSnapshotIdsByPaths(input.sourceSnapshotPaths),
      ])
    : StringListTextSchema.parse(existing.sourceSnapshotIdsJson)
  const metadata = input.metadata === undefined
    ? JsonRecordTextSchema.parse(existing.metadataJson)
    : {
        ...JsonRecordTextSchema.parse(existing.metadataJson),
        ...input.metadata,
        updatedBy: 'chronicle-memory-update',
      }
  const updated = db().transaction((tx) => {
    tx.update(chronicleMemories).set({
      content,
      contentHash,
      sourceSnapshotIdsJson: JSON.stringify(sourceSnapshotIds),
      sourcePathsJson: JSON.stringify(sourcePaths),
      metadataJson: JSON.stringify(metadata),
      updatedAt: now,
    }).where(eq(chronicleMemories.id, memoryId)).run()
    const row = tx.select().from(chronicleMemories).where(eq(chronicleMemories.id, memoryId)).get()!
    syncMemorySearchIndex(tx, row)
    return row
  })
  recordEvent({
    type: 'memory',
    status: 'success',
    message: 'Chronicle memory updated',
    memoryId,
    attrs: { contentChanged: content !== existing.content },
  })
  return toMemoryEntry(updated)
}

export function deleteMemory(memoryId: string): { ok: true } {
  const existing = db().select().from(chronicleMemories).where(eq(chronicleMemories.id, memoryId)).get()
  if (!existing) {
    throw new AppError({ code: 'chronicle_memory_not_found', status: 404, message: 'Chronicle memory not found' })
  }
  recordEvent({
    type: 'memory',
    status: 'success',
    message: 'Chronicle memory deleted',
    memoryId,
    attrs: { sourceId: existing.sourceId, contentHash: existing.contentHash },
  })
  db().delete(chronicleMemories).where(eq(chronicleMemories.id, memoryId)).run()
  return { ok: true }
}

const PII_PATTERNS: Array<{ type: string, pattern: RegExp }> = [
  { type: 'api_key', pattern: /\bsk-[\w-]{8,}\b/g },
  { type: 'api_key', pattern: /\bxox[abprs]-[A-Za-z0-9-]{8,}\b/g },
  { type: 'api_key', pattern: /\b(?:ghp|github_pat|glpat|hf)_[\w-]{12,}\b/g },
  { type: 'email', pattern: /\b[\w.%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'phone_number', pattern: /(?<!\w)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
  { type: 'ip_address', pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g },
  { type: 'credit_card', pattern: /\b(?:\d[ -]*?){13,19}\b/g },
]

function isLikelyCreditCardNumber(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) {
    return false
  }
  let sum = 0
  let doubleDigit = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index])
    if (doubleDigit) {
      value *= 2
      if (value > 9) {
        value -= 9
      }
    }
    sum += value
    doubleDigit = !doubleDigit
  }
  return sum % 10 === 0
}

function detectPrivacyEntities(text: string): PrivacyEntity[] {
  const entities: PrivacyEntity[] = []
  for (const { type, pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      const value = match[0]
      const start = match.index ?? 0
      if (type === 'credit_card' && !isLikelyCreditCardNumber(value.replace(/\D/g, ''))) {
        continue
      }
      entities.push({
        type,
        start,
        end: start + value.length,
        text: value,
      })
    }
  }

  entities.sort((left, right) => left.start - right.start || right.end - left.end)
  const deduped: PrivacyEntity[] = []
  for (const entity of entities) {
    const previous = deduped.at(-1)
    if (previous && entity.start < previous.end) {
      continue
    }
    deduped.push(entity)
  }
  return deduped
}

export function redactPrivacyText(input: { text: string }): PrivacyRedactionResult {
  const entities = detectPrivacyEntities(input.text)
  let redactedText = input.text
  for (const entity of entities.slice().reverse()) {
    redactedText = `${redactedText.slice(0, entity.start)}[${entity.type.toUpperCase()}]${redactedText.slice(entity.end)}`
  }
  recordPrivacyBreadcrumb({
    kind: 'text-redaction',
    status: entities.length > 0 ? 'success' : 'info',
    message: entities.length > 0 ? 'Chronicle privacy redacted text' : 'Chronicle privacy found no sensitive text',
    attrs: { entityCount: entities.length, entityTypes: [...new Set(entities.map(entity => entity.type))] },
  })
  return {
    text: input.text,
    redactedText,
    entityCount: entities.length,
    entities,
  }
}

function recordPrivacyBreadcrumb(rawInput: z.input<typeof PrivacyBreadcrumbInputSchema>): void {
  const input = PrivacyBreadcrumbInputSchema.parse(rawInput)
  recordEvent({
    type: 'activity',
    status: input.status,
    message: input.message,
    snapshotId: input.snapshotId,
    memoryId: input.memoryId,
    attrs: {
      ...input.attrs,
      privacyKind: input.kind,
      source: 'chronicle-privacy',
    },
  })
}

function toPrivacyBreadcrumbEntry(row: typeof chronicleEvents.$inferSelect): PrivacyBreadcrumbEntry {
  const attrs = PrivacyBreadcrumbAttrsTextSchema.parse(row.attrsJson)
  return {
    id: row.id,
    kind: attrs.privacyKind,
    status: row.status,
    message: row.message,
    snapshotId: row.snapshotId,
    memoryId: row.memoryId,
    attrs,
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
  }
}

export function listPrivacyBreadcrumbs(limit = 50): PrivacyBreadcrumbEntry[] {
  const rows = db()
    .select()
    .from(chronicleEvents)
    .orderBy(desc(chronicleEvents.createdAt))
    .limit(Math.max(1, Math.min(limit, 200)))
    .all()

  return rows
    .filter((row) => {
      const attrs = PrivacyBreadcrumbAttrsTextSchema.parse(row.attrsJson)
      return attrs.source === 'chronicle-privacy' || attrs.privacyKind !== 'unknown'
    })
    .map(toPrivacyBreadcrumbEntry)
}

export function listRealtimeEvents(rawInput: { limit?: number, after?: number } = {}): ChronicleRealtimeEventEntry[] {
  const input = RealtimeEventsInputSchema.parse(rawInput)
  let query = db()
    .select()
    .from(chronicleEvents)
    .$dynamic()
  if (input.after !== null) {
    query = query.where(sql`${chronicleEvents.createdAt} > ${input.after}`)
  }
  return query
    .orderBy(desc(chronicleEvents.createdAt))
    .limit(input.limit)
    .all()
    .map(toRealtimeEventEntry)
    .reverse()
}

function toRealtimeEventEntry(row: typeof chronicleEvents.$inferSelect): ChronicleRealtimeEventEntry {
  const attrs = RealtimeAttrsTextSchema.parse(row.attrsJson)
  const channel = toRealtimeChannel(row.type, row.status, attrs)
  return {
    id: row.id,
    channel,
    event: `chronicle.${channel}.${row.status}`,
    type: row.type,
    status: row.status,
    message: row.message,
    snapshotId: row.snapshotId,
    memoryId: row.memoryId,
    attrs,
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
  }
}

function toRealtimeChannel(
  type: ChronicleRealtimeEventEntry['type'],
  status: ChronicleRealtimeEventEntry['status'],
  attrs: z.infer<typeof RealtimeAttrsTextSchema>,
): ChronicleRealtimeChannel {
  if (status === 'error') {
    return 'error'
  }
  if (type === 'memory' || type === 'summarize') {
    return 'memory'
  }
  if (type === 'model-resource') {
    return 'model'
  }
  if (type === 'snapshot') {
    return 'snapshot'
  }
  if (type === 'message') {
    return 'message'
  }
  if (type === 'audio') {
    return 'audio'
  }
  if (type === 'activity') {
    return attrs.privacyKind ? 'notification' : 'activity'
  }
  return 'notification'
}

interface ExportItem {
  type: string
  id: string
  title: string
  body: string
}

function collectPrivacyExportItems(rawInput: {
  workspaceId?: string | null
  limit?: number
  includeMemories?: boolean
  includeMessages?: boolean
  includeAudioTranscripts?: boolean
  includeSnapshots?: boolean
}): ExportItem[] {
  const input = PrivacyExportInputSchema.parse(rawInput)
  const items: ExportItem[] = []

  if (input.includeMemories) {
    const rows = input.workspaceId
      ? db().select().from(chronicleMemories).where(eq(chronicleMemories.workspaceId, input.workspaceId)).orderBy(desc(chronicleMemories.createdAt)).limit(input.limit).all()
      : db().select().from(chronicleMemories).orderBy(desc(chronicleMemories.createdAt)).limit(input.limit).all()
    items.push(...rows.map(row => ({
      type: 'memory',
      id: row.id,
      title: `Memory ${new Date(row.createdAt * 1000).toISOString()}`,
      body: row.content,
    })))
  }

  if (input.includeMessages) {
    const rows = input.workspaceId
      ? db().select().from(chronicleMessages).where(eq(chronicleMessages.workspaceId, input.workspaceId)).orderBy(desc(chronicleMessages.messageAt)).limit(input.limit).all()
      : db().select().from(chronicleMessages).orderBy(desc(chronicleMessages.messageAt)).limit(input.limit).all()
    items.push(...rows.map(row => ({
      type: 'message',
      id: row.id,
      title: row.channelName ?? row.channelId,
      body: row.text,
    })))
  }

  if (input.includeAudioTranscripts) {
    const rows = input.workspaceId
      ? db().select().from(chronicleAudioTranscripts).where(eq(chronicleAudioTranscripts.workspaceId, input.workspaceId)).orderBy(desc(chronicleAudioTranscripts.startedAt)).limit(input.limit).all()
      : db().select().from(chronicleAudioTranscripts).orderBy(desc(chronicleAudioTranscripts.startedAt)).limit(input.limit).all()
    items.push(...rows.map(row => ({
      type: 'audio-transcript',
      id: row.id,
      title: row.title ?? 'Audio transcript',
      body: buildAudioTranscriptPreview(row.id),
    })))
  }

  if (input.includeSnapshots) {
    const rows = input.workspaceId
      ? db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.workspaceId, input.workspaceId)).orderBy(desc(chronicleSnapshots.capturedAt)).limit(input.limit).all()
      : db().select().from(chronicleSnapshots).orderBy(desc(chronicleSnapshots.capturedAt)).limit(input.limit).all()
    items.push(...rows.map(row => ({
      type: 'snapshot',
      id: row.id,
      title: row.windowTitle ?? row.appBundleId ?? 'Snapshot',
      body: row.ocrText ?? '',
    })).filter(item => item.body.length > 0))
  }

  return items.slice(0, input.limit)
}

export function exportPrivacyRedacted(rawInput: {
  workspaceId?: string | null
  limit?: number
  includeMemories?: boolean
  includeMessages?: boolean
  includeAudioTranscripts?: boolean
  includeSnapshots?: boolean
  outputFormat?: 'markdown' | 'json'
}): PrivacyExportResult {
  const input = PrivacyExportInputSchema.parse(rawInput)
  const format = input.outputFormat
  const items = collectPrivacyExportItems(input)
  const redacted = items.map((item) => {
    const result = redactPrivacyText({ text: item.body })
    return { item, result }
  })
  const entityCount = redacted.reduce((total, entry) => total + entry.result.entityCount, 0)
  const sources = redacted.map(({ item, result }) => ({
    type: item.type,
    id: item.id,
    title: item.title,
    redactedEntityCount: result.entityCount,
  }))
  const content = format === 'json'
    ? JSON.stringify(redacted.map(({ item, result }) => ({
      type: item.type,
      id: item.id,
      title: item.title,
      text: result.redactedText,
      redactedEntityCount: result.entityCount,
    })), null, 2)
    : redacted.map(({ item, result }) => [
      `## ${item.title}`,
      `Source: ${item.type}/${item.id}`,
      '',
      result.redactedText,
    ].join('\n')).join('\n\n')

  recordPrivacyBreadcrumb({
    kind: 'redacted-export',
    status: 'success',
    message: 'Chronicle privacy generated redacted export',
    attrs: { format, sourceCount: sources.length, entityCount },
  })
  return { format, content, entityCount, sources }
}

export function searchMemories(query: string, limit = 20): MemoryEntry[] {
  reconcileMemorySearchIndex()
  const needle = query.trim()
  if (!needle) {
    return getMemories(limit)
  }
  const terms = tokenizeMemoryText(needle).slice(0, MEMORY_SEARCH_MAX_TERMS)
  if (terms.length === 0) {
    return []
  }

  const keywordRows = db()
    .select()
    .from(chronicleMemoryKeywords)
    .where(inArray(chronicleMemoryKeywords.term, terms))
    .all()

  const scoreByMemoryId = new Map<string, MemorySearchScore>()
  for (const row of keywordRows) {
    const phraseBoost = terms.includes(row.term) ? 1 : 0
    const current = scoreByMemoryId.get(row.memoryId) ?? { keywordScore: 0, semanticScore: 0 }
    current.keywordScore += row.occurrences * row.weight + phraseBoost
    scoreByMemoryId.set(row.memoryId, current)
  }

  const queryEmbedding = buildTextEmbeddingVector(needle)
  const embeddingRows = db()
    .select()
    .from(chronicleMemoryEmbeddings)
    .where(sql`${chronicleMemoryEmbeddings.status} = 'ready' AND ${chronicleMemoryEmbeddings.modelId} = ${queryEmbedding.modelId} AND ${chronicleMemoryEmbeddings.modelVersion} = ${queryEmbedding.modelVersion}`)
    .all()

  for (const row of embeddingRows) {
    const vector = NumberListTextSchema.parse(row.vectorJson)
    if (vector.length !== row.dimensions) {
      throw new AppError({
        code: 'chronicle_memory_embedding_invalid',
        status: 500,
        message: 'Stored Chronicle memory embedding has invalid dimensions',
        details: {
          embeddingId: row.id,
          expectedDimensions: row.dimensions,
          actualDimensions: vector.length,
        },
      })
    }
    const semanticScore = cosineSimilarity(queryEmbedding.vector, vector)
    if (semanticScore < MEMORY_SEMANTIC_MIN_SCORE) {
      continue
    }
    const current = scoreByMemoryId.get(row.memoryId) ?? { keywordScore: 0, semanticScore: 0 }
    current.semanticScore = Math.max(current.semanticScore, semanticScore)
    scoreByMemoryId.set(row.memoryId, current)
  }

  if (scoreByMemoryId.size === 0) {
    return []
  }

  const rows = db()
    .select()
    .from(chronicleMemories)
    .where(inArray(chronicleMemories.id, [...scoreByMemoryId.keys()]))
    .all()

  const normalizedNeedle = canonicalizeMemoryContent(needle)
  return rows
    .map(row => ({
      row,
      match: scoreByMemoryId.get(row.id) ?? { keywordScore: 0, semanticScore: 0 },
      score: buildCombinedMemorySearchScore(
        scoreByMemoryId.get(row.id) ?? { keywordScore: 0, semanticScore: 0 },
        canonicalizeMemoryContent(row.content).includes(normalizedNeedle),
      ),
    }))
    .sort((left, right) => right.score - left.score || right.row.createdAt - left.row.createdAt)
    .slice(0, limit)
    .map(({ row, match }) => toMemoryEntry(row, match))
}

export function embedTexts(input: EmbeddingRequestInput): EmbeddingResponse {
  const texts = input.texts.map(text => text.trim()).filter(Boolean)
  if (texts.length === 0 || texts.length > 64) {
    throw new AppError({
      code: 'chronicle_embedding_request_invalid',
      status: 400,
      message: 'Embedding request must include 1-64 non-empty texts',
    })
  }
  const health = getOnnxEmbeddingRuntimeHealth()
  if (!health.ok) {
    throw new AppError({
      code: 'chronicle_embedding_model_unavailable',
      status: 503,
      message: health.error ?? 'Chronicle ONNX embedding runtime is not available',
    })
  }
  try {
    const response = EmbeddingBatchSchema.parse(DaemonManager.runEmbeddingBatch(texts, getModelResourcesRoot()))
    if (response.embeddings.length !== texts.length) {
      throw new Error('embedding response has an invalid embedding count')
    }
    return {
      modelId: response.modelId,
      modelVersion: response.modelVersion,
      dimensions: response.dimensions,
      embeddings: response.embeddings,
    }
  }
  catch (error) {
    throw new AppError({
      code: 'chronicle_embedding_failed',
      status: 500,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function getModelResources(): Promise<ModelResourceEntry[]> {
  seedModelResources()
  return listModelResourceRows()
}

export async function reconcileModelResources(): Promise<ModelResourceEntry[]> {
  seedModelResources()
  for (const category of Object.keys(builtInModelManifests) as ModelResourceCategory[]) {
    await verifyModelResource(category, { recordEventOnSuccess: false })
  }
  return listModelResourceRows()
}

export async function installAllModelResources(): Promise<ModelResourceEntry[]> {
  seedModelResources()
  const categories = Object.keys(builtInModelManifests) as ModelResourceCategory[]
  for (const category of categories) {
    try {
      const manifest = getModelResourceManifest(category)
      // Skip categories with no files or missing source URLs
      const hasDownloadableFiles = manifest.files.length > 0 && manifest.files.every(f => !!f.sourceUrl)
      if (hasDownloadableFiles) {
        await installModelResource(category, { source: 'manifest' })
      }
    }
 catch {
      // Continue installing other models even if one fails
    }
  }
  return listModelResourceRows()
}

export async function verifyModelResource(
  category: ModelResourceCategory,
  options: { recordEventOnSuccess?: boolean } = {},
): Promise<ModelResourceEntry> {
  if (category === 'embedding') {
    clearEmbeddingRuntimeHealth()
  }
  const manifest = getModelResourceManifest(category)
  const current = getModelResourceRow(category)
  const now = currentUnixSeconds()

  if (manifest.files.length === 0) {
    const metadata = buildModelResourceMetadata(manifest, {
      verifiedAt: now,
      files: [],
    })
    db().update(chronicleModelResources).set({
      status: 'available',
      displayName: manifest.displayName,
      path: null,
      version: manifest.version,
      message: manifest.message,
      sizeBytes: 0,
      metadataJson: JSON.stringify(metadata),
      updatedAt: now,
    }).where(eq(chronicleModelResources.id, current.id)).run()
    return getModelResourceEntry(category)
  }

  const checks = await checkModelResourceFiles(manifest)
  const missingRequired = checks.filter(check => check.required && !check.exists)
  const failedChecksum = checks.filter(check => check.exists && check.sha256 && check.actualSha256 !== check.sha256)
  const failedSize = checks.filter(check => check.exists && check.expectedSizeBytes !== undefined && check.actualSizeBytes !== check.expectedSizeBytes)
  const presentSizeBytes = checks.reduce((total, check) => total + (check.actualSizeBytes ?? 0), 0)
  const firstModelPath = checks.find(check => check.exists)?.absolutePath ?? getModelResourceAbsolutePath(manifest.files[0].path)
  const metadata = buildModelResourceMetadata(manifest, {
    verifiedAt: now,
    files: checks,
  })

  if (missingRequired.length > 0) {
    db().update(chronicleModelResources).set({
      status: 'missing',
      displayName: manifest.displayName,
      path: null,
      version: manifest.version,
      message: `Missing ${missingRequired.length} required model file${missingRequired.length === 1 ? '' : 's'}.`,
      sizeBytes: presentSizeBytes,
      metadataJson: JSON.stringify(metadata),
      updatedAt: now,
    }).where(eq(chronicleModelResources.id, current.id)).run()
    return getModelResourceEntry(category)
  }

  if (failedChecksum.length > 0 || failedSize.length > 0) {
    const message = failedChecksum.length > 0
      ? `Checksum failed for ${failedChecksum.map(check => check.relativePath).join(', ')}.`
      : `Size check failed for ${failedSize.map(check => check.relativePath).join(', ')}.`
    db().update(chronicleModelResources).set({
      status: 'error',
      displayName: manifest.displayName,
      path: rootRelativeModelPath(firstModelPath),
      version: manifest.version,
      message,
      sizeBytes: presentSizeBytes,
      metadataJson: JSON.stringify(metadata),
      updatedAt: now,
    }).where(eq(chronicleModelResources.id, current.id)).run()
    recordEvent({
      type: 'model-resource',
      status: 'error',
      message,
      attrs: { category },
    })
    return getModelResourceEntry(category)
  }

  db().update(chronicleModelResources).set({
    status: 'available',
    displayName: manifest.displayName,
    path: rootRelativeModelPath(firstModelPath),
    version: manifest.version,
    message: `Verified ${manifest.displayName}.`,
    sizeBytes: presentSizeBytes,
    metadataJson: JSON.stringify(metadata),
    updatedAt: now,
  }).where(eq(chronicleModelResources.id, current.id)).run()

  if (options.recordEventOnSuccess !== false) {
    recordEvent({
      type: 'model-resource',
      status: 'success',
      message: `Verified ${manifest.displayName}`,
      attrs: { category, sizeBytes: presentSizeBytes },
    })
  }
  return getModelResourceEntry(category)
}

export async function installModelResource(
  category: ModelResourceCategory,
  rawInput: ModelResourceInstallInput,
): Promise<ModelResourceEntry> {
  if (category === 'embedding') {
    clearEmbeddingRuntimeHealth()
  }
  const input = ModelResourceInstallInputSchema.parse(rawInput)
  const manifest = getModelResourceManifest(category)
  if (manifest.files.length === 0) {
    return verifyModelResource(category)
  }

  const source = input.source
  const localFiles = input.files
  const sourceRoot = input.sourceRoot
  if (source === 'local-files' && localFiles.length === 0 && !sourceRoot) {
    throw new AppError({
      code: 'chronicle_model_resource_source_missing',
      status: 400,
      message: 'Local model resource install requires files or sourceRoot',
    })
  }
  if (source === 'manifest') {
    assertManifestInstallAllowed(manifest)
  }

  const now = currentUnixSeconds()
  const current = getModelResourceRow(category)
  const firstTargetPath = getModelResourceAbsolutePath(manifest.files[0].path)
  db().update(chronicleModelResources).set({
    status: 'installing',
    displayName: manifest.displayName,
    path: rootRelativeModelPath(firstTargetPath),
    version: manifest.version,
    message: 'Installing model resource.',
    metadataJson: JSON.stringify(buildModelResourceMetadata(manifest, { installingAt: now })),
    updatedAt: now,
  }).where(eq(chronicleModelResources.id, current.id)).run()

  const tempPaths: string[] = []
  const promotedPaths: string[] = []
  try {
    const stagedFiles: Array<{ tempPath: string, targetPath: string }> = []
    for (const file of manifest.files) {
      const targetPath = getModelResourceAbsolutePath(file.path)
      const tempPath = `${targetPath}.tmp-${randomUUID()}`
      tempPaths.push(tempPath)
      await mkdir(dirname(targetPath), { recursive: true })

      if (source === 'local-files') {
        const resolvedSource = await resolveModelResourceLocalSource(localFiles, sourceRoot, file, manifest.files.length)
        await copyFile(resolvedSource, tempPath)
      }
      else {
        await downloadModelResourceFile(file, tempPath, category)
      }

      await verifyStagedModelFile(file, tempPath)
      stagedFiles.push({ tempPath, targetPath })
    }

    for (const stagedFile of stagedFiles) {
      await rename(stagedFile.tempPath, stagedFile.targetPath)
      promotedPaths.push(stagedFile.targetPath)
    }
    const verified = await verifyModelResource(category)
    recordEvent({
      type: 'model-resource',
      status: 'success',
      message: `Installed ${manifest.displayName}`,
      attrs: { category, source },
    })
    return verified
  }
  catch (error) {
    for (const tempPath of tempPaths) {
      await rm(tempPath, { force: true }).catch(() => {})
    }
    for (const promotedPath of promotedPaths) {
      await rm(promotedPath, { force: true }).catch(() => {})
    }
    const message = error instanceof Error ? error.message : String(error)
    db().update(chronicleModelResources).set({
      status: 'error',
      message,
      updatedAt: currentUnixSeconds(),
    }).where(eq(chronicleModelResources.id, current.id)).run()
    recordEvent({
      type: 'model-resource',
      status: 'error',
      message,
      attrs: { category },
    })
    return getModelResourceEntry(category)
  }
}

export async function removeModelResource(category: ModelResourceCategory): Promise<ModelResourceEntry> {
  if (category === 'embedding') {
    clearEmbeddingRuntimeHealth()
  }
  const manifest = getModelResourceManifest(category)
  for (const file of manifest.files) {
    await rm(getModelResourceAbsolutePath(file.path), { force: true }).catch(() => {})
  }
  const current = getModelResourceRow(category)
  const now = currentUnixSeconds()
  db().update(chronicleModelResources).set({
    status: manifest.files.length === 0 ? 'available' : 'missing',
    displayName: manifest.displayName,
    path: null,
    version: manifest.version,
    message: manifest.files.length === 0 ? manifest.message : 'Model resource files removed.',
    sizeBytes: 0,
    metadataJson: JSON.stringify(buildModelResourceMetadata(manifest, { removedAt: now })),
    updatedAt: now,
  }).where(eq(chronicleModelResources.id, current.id)).run()
  recordEvent({
    type: 'model-resource',
    status: 'success',
    message: `Removed ${manifest.displayName}`,
    attrs: { category },
  })
  return getModelResourceEntry(category)
}

export function listMessageSources(): MessageSourceEntry[] {
  return db()
    .select()
    .from(chronicleMessageSources)
    .orderBy(chronicleMessageSources.label)
    .all()
    .map(toMessageSourceEntry)
}

export function createMessageSource(rawInput: MessageSourceInput): MessageSourceEntry {
  const input = MessageSourceInputSchema.parse(rawInput)
  const now = currentUnixSeconds()
  const id = randomUUID()
  const sourceConfig = SlackSourceConfigSchema.parse({
    realtimeMode: input.realtimeMode,
    signingSecretRef: input.signingSecretRef,
    socketAppTokenRef: input.socketAppTokenRef,
  })
  db().insert(chronicleMessageSources).values({
    id,
    platform: input.platform,
    label: input.label,
    enabled: input.enabled,
    workspaceId: input.workspaceId,
    teamId: input.teamId,
    botTokenRef: input.botTokenRef,
    channelIdsJson: JSON.stringify(input.channelIds),
    configJson: JSON.stringify(sourceConfig),
    status: input.enabled ? 'idle' : 'disabled',
    createdAt: now,
    updatedAt: now,
  }).run()
  recordEvent({
    type: 'message',
    status: 'success',
    message: 'Chronicle Slack source created',
    attrs: { sourceId: id, label: input.label },
  })
  return getMessageSourceEntry(id)
}

export function updateMessageSource(sourceId: string, rawInput: MessageSourcePatchInput): MessageSourceEntry {
  const input = MessageSourcePatchInputSchema.parse(rawInput)
  const existing = db().select().from(chronicleMessageSources).where(eq(chronicleMessageSources.id, sourceId)).get()
  if (!existing) {
    throw new AppError({ code: 'chronicle_message_source_not_found', status: 404, message: 'Chronicle message source not found' })
  }
  const nextEnabled = input.enabled ?? existing.enabled
  const nextConfig = mergeSlackSourceConfig(existing.configJson, {
    realtimeMode: input.realtimeMode,
    signingSecretRef: input.signingSecretRef,
    socketAppTokenRef: input.socketAppTokenRef,
  })
  db().update(chronicleMessageSources).set({
    label: input.label ?? existing.label,
    enabled: nextEnabled,
    workspaceId: input.workspaceId === undefined ? existing.workspaceId : input.workspaceId,
    teamId: input.teamId === undefined ? existing.teamId : input.teamId,
    botTokenRef: input.botTokenRef === undefined ? existing.botTokenRef : input.botTokenRef,
    channelIdsJson: input.channelIds === undefined ? existing.channelIdsJson : JSON.stringify(input.channelIds),
    configJson: JSON.stringify(nextConfig),
    status: nextEnabled ? existing.status === 'disabled' ? 'idle' : existing.status : 'disabled',
    updatedAt: currentUnixSeconds(),
  }).where(eq(chronicleMessageSources.id, sourceId)).run()
  return getMessageSourceEntry(sourceId)
}

export function deleteMessageSource(sourceId: string): { ok: true } {
  db().delete(chronicleMessageSources).where(eq(chronicleMessageSources.id, sourceId)).run()
  recordEvent({
    type: 'message',
    status: 'success',
    message: 'Chronicle Slack source deleted',
    attrs: { sourceId },
  })
  return { ok: true }
}

export function listMessages(limit = 50): MessageEntry[] {
  return db()
    .select()
    .from(chronicleMessages)
    .orderBy(desc(chronicleMessages.messageAt))
    .limit(limit)
    .all()
    .map(toMessageEntry)
}

export function listAudioTranscripts(limit = 20): AudioTranscriptEntry[] {
  return db()
    .select()
    .from(chronicleAudioTranscripts)
    .orderBy(desc(chronicleAudioTranscripts.startedAt))
    .limit(limit)
    .all()
    .map(row => toAudioTranscriptEntry(row))
}

export function listAudioRawSegments(limit = 20): AudioRawSegmentEntry[] {
  return db()
    .select()
    .from(chronicleAudioRawSegments)
    .orderBy(desc(chronicleAudioRawSegments.recordedAt))
    .limit(limit)
    .all()
    .map(toAudioRawSegmentEntry)
}

export function listAccessibilitySnapshots(limit = 20): AccessibilitySnapshotEntry[] {
  return db()
    .select()
    .from(chronicleAccessibilitySnapshots)
    .orderBy(desc(chronicleAccessibilitySnapshots.capturedAt))
    .limit(limit)
    .all()
    .map(toAccessibilitySnapshotEntry)
}

export function listAccessibilityEvents(limit = 50): AccessibilityEventEntry[] {
  return db()
    .select()
    .from(chronicleAccessibilityEvents)
    .orderBy(desc(chronicleAccessibilityEvents.capturedAt))
    .limit(limit)
    .all()
    .map(toAccessibilityEventEntry)
}

export function listActivitySegments(limit = 20): ActivitySegmentEntry[] {
  return db()
    .select()
    .from(chronicleActivitySegments)
    .orderBy(desc(chronicleActivitySegments.startedAt))
    .limit(limit)
    .all()
    .map(toActivitySegmentEntry)
}

export async function getActivityMonitorStatus(): Promise<ActivityMonitorStatusEntry> {
  const status = await getStatus()
  const config = await getConfig()
  const monitorStatus = !config.enabled
    ? 'disabled'
    : status.running ? 'running' : 'unavailable'
  const captureStatus = status.lastErrorAt !== null && status.lastCaptureAt === null
    ? 'error'
    : status.running ? 'capturing' : 'idle'
  const pipelineStatus = !status.activityPipelineEnabled
    ? 'disabled'
    : status.activityPipelineRunning ? 'running' : 'idle'

  return {
    enabled: config.enabled,
    available: status.available,
    running: status.running,
    pid: status.pid,
    monitorStatus,
    captureStatus,
    pipelineStatus,
    audioStatus: status.audioRuntimeStatus,
    lastCaptureAt: unixSecondsToIso(status.lastCaptureAt),
    lastCaptureAtUnix: status.lastCaptureAt,
    lastActivityAt: unixSecondsToIso(status.lastActivitySegmentAt),
    lastActivityAtUnix: status.lastActivitySegmentAt,
    lastPipelineRunAt: unixSecondsToIso(status.lastPipelineRunAt),
    lastPipelineRunAtUnix: status.lastPipelineRunAt,
    lastErrorAt: unixSecondsToIso(status.lastErrorAt),
    lastErrorAtUnix: status.lastErrorAt,
    lastError: status.lastError,
    totals: {
      snapshots: status.totalSnapshots,
      activitySessions: countTable('chronicle_activity_sessions'),
      activitySegments: status.totalActivitySegments,
      pipelineRuns: status.totalPipelineRuns,
      accessibilitySnapshots: status.totalAccessibilitySnapshots,
      accessibilityEvents: status.totalAccessibilityEvents,
      audioTranscripts: status.totalAudioTranscripts,
      audioRawSegments: status.totalAudioRawSegments,
      memories: status.totalSummaries,
      messages: status.totalMessages,
    },
    config: {
      activityPipelineEnabled: status.activityPipelineEnabled,
      activityPipelineIntervalMs: status.activityPipelineIntervalMs,
      activityPipelineBatchSize: status.activityPipelineBatchSize,
      audioCaptureEnabled: status.audioCaptureEnabled,
      audioSource: status.audioSource,
      closedEyesDiscardEnabled: status.closedEyesDiscardEnabled,
      closedEyesMode: status.closedEyesMode,
    },
  }
}

export async function getActivityStorageStats(): Promise<ActivityStorageStatsEntry> {
  const config = await getConfig()
  const storageRoot = resolve(config.storageRoot)
  const modelsRoot = getModelResourcesRoot()
  const [storage, models] = await Promise.all([
    collectDirectoryStats(storageRoot),
    collectDirectoryStats(modelsRoot),
  ])

  return {
    storageRoot,
    modelsRoot,
    storage,
    models,
    database: {
      snapshots: countTable('chronicle_snapshots'),
      activitySessions: countTable('chronicle_activity_sessions'),
      activitySegments: countTable('chronicle_activity_segments'),
      memories: countTable('chronicle_memories'),
      memoryChunks: countTable('chronicle_memory_chunks'),
      knowledgeCards: db().get<{ count: number }>(sql`SELECT COUNT(*) AS count FROM chronicle_knowledge_cards WHERE status != 'deleted'`)?.count ?? 0,
      pipelineRuns: countTable('chronicle_pipeline_runs'),
      dreamRuns: countTable('chronicle_dream_runs'),
      accessibilitySnapshots: countTable('chronicle_accessibility_snapshots'),
      accessibilityEvents: countTable('chronicle_accessibility_events'),
      audioTranscripts: countTable('chronicle_audio_transcripts'),
      audioRawSegments: countTable('chronicle_audio_raw_segments'),
      messages: countTable('chronicle_messages'),
      modelResources: countTable('chronicle_model_resources'),
    },
  }
}

export async function getMemoryStatus(): Promise<MemoryStatusEntry> {
  const status = await getStatus()
  const embeddingStatusCounts = db()
    .select({
      status: chronicleMemoryEmbeddings.status,
      value: count(),
    })
    .from(chronicleMemoryEmbeddings)
    .groupBy(chronicleMemoryEmbeddings.status)
    .all()
  const embeddingCount = (target: 'ready' | 'pending' | 'error') =>
    embeddingStatusCounts.find(row => row.status === target)?.value ?? 0

  return {
    available: status.available,
    totalMemories: status.totalSummaries,
    totalChunks: countTable('chronicle_memory_chunks'),
    totalKeywords: countTable('chronicle_memory_keywords'),
    totalEmbeddings: countTable('chronicle_memory_embeddings'),
    totalKnowledgeCards: status.totalKnowledgeCards,
    totalKnowledgeVersions: countTable('chronicle_knowledge_versions'),
    totalActivitySegments: status.totalActivitySegments,
    pendingActivitySegments: db().get<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM chronicle_activity_segments WHERE is_crystallized = 0`,
    )?.count ?? 0,
    crystallizedActivitySegments: db().get<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM chronicle_activity_segments WHERE is_crystallized = 1`,
    )?.count ?? 0,
    totalPipelineRuns: status.totalPipelineRuns,
    lastMemoryAt: unixSecondsToIso(status.lastSummaryAt),
    lastMemoryAtUnix: status.lastSummaryAt,
    lastKnowledgeCardAt: unixSecondsToIso(status.lastKnowledgeCardAt),
    lastKnowledgeCardAtUnix: status.lastKnowledgeCardAt,
    lastPipelineRunAt: unixSecondsToIso(status.lastPipelineRunAt),
    lastPipelineRunAtUnix: status.lastPipelineRunAt,
    searchIndex: {
      chunkCount: countTable('chronicle_memory_chunks'),
      keywordCount: countTable('chronicle_memory_keywords'),
      embeddingCount: countTable('chronicle_memory_embeddings'),
      embeddingReadyCount: embeddingCount('ready'),
      embeddingPendingCount: embeddingCount('pending'),
      embeddingErrorCount: embeddingCount('error'),
    },
    pipeline: {
      activityPipelineEnabled: status.activityPipelineEnabled,
      activityPipelineRunning: status.activityPipelineRunning,
      dreamSchedulerEnabled: status.dreamSchedulerEnabled,
      dreamSchedulerRunning: status.dreamSchedulerRunning,
    },
  }
}

export async function crystallizeMemory(rawInput: MemoryCrystallizeInput = {}): Promise<MemoryCrystallizeEntry> {
  const input = MemoryCrystallizeInputSchema.parse(rawInput)
  const segmentId = input.segmentId ?? db()
    .select({ id: chronicleActivitySegments.id })
    .from(chronicleActivitySegments)
    .where(sql`${chronicleActivitySegments.isCrystallized} = 0`)
    .orderBy(chronicleActivitySegments.startedAt)
    .limit(1)
    .get()
?.id

  if (!segmentId) {
    return {
      status: 'skipped',
      message: 'No activity segment is ready for memory crystallization',
      segmentId: null,
      result: null,
    }
  }

  const result = await crystallizeActivitySegment(segmentId)
  return {
    status: result.status,
    message: result.message,
    segmentId,
    result,
  }
}

export function listActivitySessions(limit = 20): ActivitySessionEntry[] {
  return db()
    .select()
    .from(chronicleActivitySessions)
    .orderBy(desc(chronicleActivitySessions.startedAt))
    .limit(Math.max(1, Math.min(Math.floor(limit), 200)))
    .all()
    .map(toActivitySessionEntry)
}

export function getActivitySession(sessionId: string): ActivitySessionDetailEntry {
  const row = db()
    .select()
    .from(chronicleActivitySessions)
    .where(eq(chronicleActivitySessions.id, sessionId))
    .get()
  if (!row) {
    throw new AppError({ code: 'chronicle_activity_session_not_found', status: 404, message: 'Chronicle activity session not found' })
  }
  const segments = db()
    .select()
    .from(chronicleActivitySegments)
    .where(eq(chronicleActivitySegments.sessionId, sessionId))
    .orderBy(desc(chronicleActivitySegments.startedAt))
    .all()
    .map(toActivitySegmentEntry)
  return {
    ...toActivitySessionEntry(row),
    segments,
  }
}

export function listActivitySessionSnapshots(sessionId: string): ActivitySnapshotEntry[] {
  const session = db()
    .select({ id: chronicleActivitySessions.id })
    .from(chronicleActivitySessions)
    .where(eq(chronicleActivitySessions.id, sessionId))
    .get()
  if (!session) {
    throw new AppError({ code: 'chronicle_activity_session_not_found', status: 404, message: 'Chronicle activity session not found' })
  }
  const snapshotIds = db()
    .select()
    .from(chronicleActivitySegments)
    .where(eq(chronicleActivitySegments.sessionId, sessionId))
    .all()
    .flatMap(segment => ActivitySourceRefsJsonSchema.parse(segment.sourceRefsJson).snapshotIds)
  const uniqueSnapshotIds = uniqueStrings(snapshotIds)
  if (uniqueSnapshotIds.length === 0) {
    return []
  }
  return db()
    .select()
    .from(chronicleSnapshots)
    .where(inArray(chronicleSnapshots.id, uniqueSnapshotIds))
    .orderBy(desc(chronicleSnapshots.capturedAt))
    .all()
    .map(toActivitySnapshotEntry)
}

export function getActivitySegment(segmentId: string): ActivitySegmentEntry {
  const row = db()
    .select()
    .from(chronicleActivitySegments)
    .where(eq(chronicleActivitySegments.id, segmentId))
    .get()
  if (!row) {
    throw new AppError({ code: 'chronicle_activity_segment_not_found', status: 404, message: 'Chronicle activity segment not found' })
  }
  return toActivitySegmentEntry(row)
}

export function getActivitySnapshot(snapshotId: string): ActivitySnapshotEntry {
  const row = db()
    .select()
    .from(chronicleSnapshots)
    .where(eq(chronicleSnapshots.id, snapshotId))
    .get()
  if (!row) {
    throw new AppError({ code: 'chronicle_snapshot_not_found', status: 404, message: 'Chronicle snapshot not found' })
  }
  return toActivitySnapshotEntry(row)
}

export function getActivitySnapshotOcr(snapshotId: string): ActivitySnapshotOcrEntry {
  const row = db()
    .select()
    .from(chronicleSnapshots)
    .where(eq(chronicleSnapshots.id, snapshotId))
    .get()
  if (!row) {
    throw new AppError({ code: 'chronicle_snapshot_not_found', status: 404, message: 'Chronicle snapshot not found' })
  }
  const metadata = SnapshotOcrMetadataTextSchema.parse(row.metadataJson)
  return {
    snapshotId: row.id,
    sourceId: row.sourceId,
    ocrText: row.ocrText,
    ocrPath: metadata.ocrPath,
    capturedAt: new Date(row.capturedAt * 1000).toISOString(),
    capturedAtUnix: row.capturedAt,
  }
}

export function listPipelineRuns(limit = 20): PipelineRunEntry[] {
  return db()
    .select()
    .from(chroniclePipelineRuns)
    .orderBy(desc(chroniclePipelineRuns.startedAt))
    .limit(limit)
    .all()
    .map(toPipelineRunEntry)
}

export function listKnowledgeCards(rawInput: {
  limit?: number
  dimension?: KnowledgeDimension
  cardType?: KnowledgeCardType
  status?: KnowledgeCardStatus
  includeDeleted?: boolean
} = {}): KnowledgeCardEntry[] {
  const input = KnowledgeCardListInputSchema.parse(rawInput)
  return db()
    .select()
    .from(chronicleKnowledgeCards)
    .orderBy(desc(chronicleKnowledgeCards.updatedAt))
    .limit(input.limit)
    .all()
    .filter(row => input.includeDeleted || row.status !== 'deleted')
    .filter(row => !input.status || row.status === input.status)
    .filter(row => !input.dimension || row.dimension === input.dimension)
    .filter(row => !input.cardType || row.cardType === input.cardType)
    .map(toKnowledgeCardEntry)
}

export function getKnowledgeCard(knowledgeId: string): KnowledgeCardEntry {
  const row = db()
    .select()
    .from(chronicleKnowledgeCards)
    .where(eq(chronicleKnowledgeCards.id, knowledgeId))
    .get()
  if (!row || row.status === 'deleted') {
    throw new AppError({ code: 'chronicle_knowledge_card_not_found', status: 404, message: 'Chronicle knowledge card not found' })
  }
  return toKnowledgeCardEntry(row)
}

export function createKnowledgeCard(rawInput: KnowledgeCardMutationInput): KnowledgeCardEntry {
  const input = KnowledgeCardMutationInputSchema.parse(rawInput)
  const now = currentUnixSeconds()
  const id = randomUUID()
  const stableKey = input.stableKey
  const contentHash = hashText(canonicalizeMemoryContent(`${input.title}\n${input.content}`))
  const row = db().transaction((tx) => {
    tx.insert(chronicleKnowledgeCards).values({
      id,
      workspaceId: null,
      title: input.title,
      content: input.content,
      cardType: input.cardType,
      dimension: input.dimension,
      confidenceBps: RatioBpsSchema.parse(input.confidence),
      sourceMemoryIdsJson: JSON.stringify(input.sourceMemoryIds),
      sourceSegmentIdsJson: JSON.stringify(input.sourceSegmentIds),
      sourceChunkIdsJson: JSON.stringify(input.sourceChunkIds),
      tagsJson: JSON.stringify(input.tags),
      stableKey,
      contentHash,
      version: 1,
      status: 'active',
      mergedIntoId: null,
      pinned: input.pinned,
      sortOrder: 0,
      metadataJson: JSON.stringify({
        ...input.metadata,
        createdBy: 'chronicle-knowledge-api',
      }),
      createdAt: now,
      updatedAt: now,
    }).run()
    getOrCreateKnowledgeVersion(tx, {
      knowledgeId: id,
      version: 1,
      title: input.title,
      content: input.content,
      cardType: input.cardType,
      dimension: input.dimension,
      confidenceBps: RatioBpsSchema.parse(input.confidence),
      sourceMemoryIds: input.sourceMemoryIds,
      sourceSegmentIds: input.sourceSegmentIds,
      sourceChunkIds: input.sourceChunkIds,
      tags: input.tags,
      metadata: { source: 'chronicle-knowledge-api-create' },
      now,
    })
    return tx.select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.id, id)).get()!
  })
  recordEvent({
    type: 'activity',
    status: 'success',
    message: 'Chronicle knowledge card created',
    attrs: { knowledgeId: id, stableKey },
  })
  return toKnowledgeCardEntry(row)
}

export function updateKnowledgeCard(knowledgeId: string, rawInput: KnowledgeCardPatchInput): KnowledgeCardEntry {
  const input = KnowledgeCardPatchInputSchema.parse(rawInput)
  const existing = db().select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.id, knowledgeId)).get()
  if (!existing || existing.status === 'deleted') {
    throw new AppError({ code: 'chronicle_knowledge_card_not_found', status: 404, message: 'Chronicle knowledge card not found' })
  }
  const next = buildKnowledgeCardPatch(existing, input)
  const materialChanged = next.title !== existing.title
    || next.content !== existing.content
    || next.cardType !== existing.cardType
    || next.dimension !== existing.dimension
    || next.confidenceBps !== existing.confidenceBps
    || next.sourceMemoryIdsJson !== existing.sourceMemoryIdsJson
    || next.sourceSegmentIdsJson !== existing.sourceSegmentIdsJson
    || next.sourceChunkIdsJson !== existing.sourceChunkIdsJson
    || next.tagsJson !== existing.tagsJson
    || next.status !== existing.status
    || next.mergedIntoId !== existing.mergedIntoId
  const now = currentUnixSeconds()
  const version = materialChanged ? existing.version + 1 : existing.version
  const row = db().transaction((tx) => {
    tx.update(chronicleKnowledgeCards).set({
      ...next,
      version,
      updatedAt: now,
    }).where(eq(chronicleKnowledgeCards.id, knowledgeId)).run()
    if (materialChanged) {
      getOrCreateKnowledgeVersion(tx, {
        knowledgeId,
        version,
        title: next.title,
        content: next.content,
        cardType: next.cardType,
        dimension: next.dimension,
        confidenceBps: next.confidenceBps,
        sourceMemoryIds: StringListTextSchema.parse(next.sourceMemoryIdsJson),
        sourceSegmentIds: StringListTextSchema.parse(next.sourceSegmentIdsJson),
        sourceChunkIds: StringListTextSchema.parse(next.sourceChunkIdsJson),
        tags: StringListTextSchema.parse(next.tagsJson),
        metadata: {
          source: 'chronicle-knowledge-api-update',
          previousVersion: existing.version,
          previousStatus: existing.status,
        },
        now,
      })
    }
    return tx.select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.id, knowledgeId)).get()!
  })
  recordEvent({
    type: 'activity',
    status: 'success',
    message: 'Chronicle knowledge card updated',
    attrs: { knowledgeId, version, materialChanged },
  })
  return toKnowledgeCardEntry(row)
}

export function deleteKnowledgeCard(knowledgeId: string): { ok: true } {
  const existing = db().select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.id, knowledgeId)).get()
  if (!existing || existing.status === 'deleted') {
    throw new AppError({ code: 'chronicle_knowledge_card_not_found', status: 404, message: 'Chronicle knowledge card not found' })
  }
  updateKnowledgeCard(knowledgeId, { status: 'deleted' })
  return { ok: true }
}

export function listKnowledgeFiles(knowledgeId: string): KnowledgeFileEntry[] {
  const card = db().select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.id, knowledgeId)).get()
  if (!card || card.status === 'deleted') {
    throw new AppError({ code: 'chronicle_knowledge_card_not_found', status: 404, message: 'Chronicle knowledge card not found' })
  }
  const explicitFiles = db()
    .select()
    .from(chronicleKnowledgeFiles)
    .where(eq(chronicleKnowledgeFiles.knowledgeId, knowledgeId))
    .all()
    .map(toKnowledgeFileEntry)
  const sources = db()
    .select()
    .from(chronicleKnowledgeSources)
    .where(eq(chronicleKnowledgeSources.knowledgeId, knowledgeId))
    .all()
  const inferredFiles = sources.flatMap(source => inferKnowledgeFilesFromSource(knowledgeId, source))
  const seen = new Set<string>()
  return [...explicitFiles, ...inferredFiles].filter((file) => {
    const key = `${file.source}:${file.filePath ?? file.filename}:${file.evidenceType ?? ''}:${file.evidenceId ?? ''}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function restoreKnowledgeVersion(knowledgeId: string, version: number): KnowledgeCardEntry {
  const existing = db().select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.id, knowledgeId)).get()
  if (!existing) {
    throw new AppError({ code: 'chronicle_knowledge_card_not_found', status: 404, message: 'Chronicle knowledge card not found' })
  }
  const targetVersion = db()
    .select()
    .from(chronicleKnowledgeVersions)
    .where(sql`${chronicleKnowledgeVersions.knowledgeId} = ${knowledgeId} AND ${chronicleKnowledgeVersions.version} = ${Math.floor(version)}`)
    .get()
  if (!targetVersion) {
    throw new AppError({ code: 'chronicle_knowledge_version_not_found', status: 404, message: 'Chronicle knowledge version not found' })
  }
  return updateKnowledgeCard(knowledgeId, {
    title: targetVersion.title,
    content: targetVersion.content,
    cardType: targetVersion.cardType,
    dimension: targetVersion.dimension,
    confidence: bpsToRatio(targetVersion.confidenceBps),
    sourceMemoryIds: StringListTextSchema.parse(targetVersion.sourceMemoryIdsJson),
    sourceSegmentIds: StringListTextSchema.parse(targetVersion.sourceSegmentIdsJson),
    sourceChunkIds: StringListTextSchema.parse(targetVersion.sourceChunkIdsJson),
    tags: StringListTextSchema.parse(targetVersion.tagsJson),
    status: 'active',
    metadata: {
      ...JsonRecordTextSchema.parse(existing.metadataJson),
      restoredFromVersion: targetVersion.version,
    },
  })
}

export function listKnowledgeVersions(knowledgeId: string): KnowledgeVersionEntry[] {
  return db()
    .select()
    .from(chronicleKnowledgeVersions)
    .where(eq(chronicleKnowledgeVersions.knowledgeId, knowledgeId))
    .orderBy(desc(chronicleKnowledgeVersions.version))
    .all()
    .map(toKnowledgeVersionEntry)
}

function buildKnowledgeCardPatch(
  existing: typeof chronicleKnowledgeCards.$inferSelect,
  input: z.infer<typeof KnowledgeCardPatchInputSchema>,
): KnowledgeCardMaterialPatch {
  const title = input.title ?? existing.title
  const content = input.content ?? existing.content
  const cardType = input.cardType ?? existing.cardType
  const dimension = input.dimension ?? existing.dimension
  const confidenceBps = input.confidence === undefined ? existing.confidenceBps : RatioBpsSchema.parse(input.confidence)
  const sourceMemoryIdsJson = input.sourceMemoryIds === undefined ? existing.sourceMemoryIdsJson : JSON.stringify(input.sourceMemoryIds)
  const sourceSegmentIdsJson = input.sourceSegmentIds === undefined ? existing.sourceSegmentIdsJson : JSON.stringify(input.sourceSegmentIds)
  const sourceChunkIdsJson = input.sourceChunkIds === undefined ? existing.sourceChunkIdsJson : JSON.stringify(input.sourceChunkIds)
  const tagsJson = input.tags === undefined ? existing.tagsJson : JSON.stringify(input.tags)
  const contentHash = hashText(canonicalizeMemoryContent(`${title}\n${content}`))
  const metadata = input.metadata === undefined
    ? JsonRecordTextSchema.parse(existing.metadataJson)
    : {
        ...JsonRecordTextSchema.parse(existing.metadataJson),
        ...input.metadata,
        updatedBy: 'chronicle-knowledge-api',
      }
  return {
    title,
    content,
    cardType,
    dimension,
    confidenceBps,
    sourceMemoryIdsJson,
    sourceSegmentIdsJson,
    sourceChunkIdsJson,
    tagsJson,
    contentHash,
    status: input.status ?? existing.status,
    mergedIntoId: input.mergedIntoId === undefined ? existing.mergedIntoId : input.mergedIntoId,
    pinned: input.pinned ?? existing.pinned,
    metadataJson: JSON.stringify(metadata),
  }
}

export function listDreamRuns(limit = 20): DreamRunEntry[] {
  const parsedLimit = DreamRunListLimitSchema.parse(limit)
  return db()
    .select()
    .from(chronicleDreamRuns)
    .orderBy(desc(chronicleDreamRuns.startedAt))
    .limit(parsedLimit)
    .all()
    .map(toDreamRunEntry)
}

export function startDreamRun(rawInput: DreamRunInput = {}): DreamRunEntry {
  const input = DreamRunInputSchema.parse(rawInput)
  const requestedRunType = input.runType
  const dryRun = input.dryRun
  const runType: DreamRunType = dryRun ? 'dry-run' : requestedRunType
  const threshold = input.similarityThreshold
  const limit = input.limit
  const olderThanDays = input.olderThanDays
  const knowledgeIds = uniqueStrings(input.knowledgeIds)
  const vectorMode = currentTextEmbeddingVectorMode()
  const now = currentUnixSeconds()
  const runId = randomUUID()
  db().insert(chronicleDreamRuns).values({
    id: runId,
    workspaceId: null,
    runType,
    status: 'running',
    startedAt: now,
    endedAt: null,
    inputCount: 0,
    outputCount: 0,
    mergedCount: 0,
    deletedCount: 0,
    sourceKnowledgeIdsJson: '[]',
    outputKnowledgeIdsJson: '[]',
    configJson: JSON.stringify({
      dryRun,
      requestedRunType,
      runType,
      limit,
      similarityThreshold: threshold,
      olderThanDays,
      knowledgeIds,
      vectorMode,
    }),
    resultJson: '{}',
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  }).run()

  try {
    if (requestedRunType !== 'merge' && requestedRunType !== 'dry-run') {
      return runDreamLifecycleOperation({
        runId,
        runType: requestedRunType,
        dryRun,
        limit,
        olderThanDays,
        knowledgeIds,
        now,
      })
    }

    const cards = selectDreamKnowledgeCards({ status: 'active', limit, knowledgeIds })
    const candidates = buildDreamMergeCandidates(cards, threshold)
    const result = db().transaction((tx) => {
      const outputKnowledgeIds: string[] = []
      for (const candidate of candidates) {
        let outputKnowledgeId: string | null = null
        if (!dryRun) {
          outputKnowledgeId = applyDreamMergeCandidate(tx, candidate, runId, now)
          outputKnowledgeIds.push(outputKnowledgeId)
        }
        tx.insert(chronicleDreamCandidates).values({
          id: randomUUID(),
          runId,
          workspaceId: candidate.workspaceId,
          candidateType: 'merge',
          scoreBps: RatioBpsSchema.parse(candidate.score),
          sourceKnowledgeIdsJson: JSON.stringify(candidate.sourceKnowledgeIds),
          proposedTitle: candidate.proposedTitle,
          proposedContent: candidate.proposedContent,
          proposedCardType: candidate.proposedCardType,
          proposedDimension: candidate.proposedDimension,
          outputKnowledgeId,
          status: outputKnowledgeId ? 'applied' : 'proposed',
          reason: candidate.reason,
          metadataJson: JSON.stringify({ vectorMode }),
          createdAt: now,
          updatedAt: now,
        }).run()
      }
      const sourceKnowledgeIds = uniqueStrings(candidates.flatMap(candidate => candidate.sourceKnowledgeIds))
      tx.update(chronicleDreamRuns).set({
        status: 'completed',
        endedAt: now,
        inputCount: cards.length,
        outputCount: dryRun ? candidates.length : outputKnowledgeIds.length,
        mergedCount: dryRun ? 0 : outputKnowledgeIds.length,
        deletedCount: 0,
        sourceKnowledgeIdsJson: JSON.stringify(sourceKnowledgeIds),
        outputKnowledgeIdsJson: JSON.stringify(outputKnowledgeIds),
        resultJson: JSON.stringify({
          dryRun,
          vectorMode,
          candidateCount: candidates.length,
          candidates: candidates.slice(0, 50),
        }),
        updatedAt: now,
      }).where(eq(chronicleDreamRuns.id, runId)).run()
      return tx.select().from(chronicleDreamRuns).where(eq(chronicleDreamRuns.id, runId)).get()!
    })
    recordEvent({
      type: 'activity',
      status: 'success',
      message: dryRun ? 'Chronicle dream merge dry run completed' : 'Chronicle dream merge completed',
      attrs: { runId, candidateCount: candidates.length, dryRun },
    })
    return toDreamRunEntry(result)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const endedAt = currentUnixSeconds()
    db().update(chronicleDreamRuns).set({
      status: 'failed',
      endedAt,
      errorMessage: message,
      updatedAt: endedAt,
    }).where(eq(chronicleDreamRuns.id, runId)).run()
    recordEvent({ type: 'activity', status: 'error', message, attrs: { runId, stage: 'dream-run' } })
    return toDreamRunEntry(db().select().from(chronicleDreamRuns).where(eq(chronicleDreamRuns.id, runId)).get()!)
  }
}

function selectDreamKnowledgeCards(input: {
  status: KnowledgeCardStatus
  limit: number
  knowledgeIds: string[]
}): Array<typeof chronicleKnowledgeCards.$inferSelect> {
  const rows = input.knowledgeIds.length > 0
    ? db()
        .select()
        .from(chronicleKnowledgeCards)
        .where(inArray(chronicleKnowledgeCards.id, input.knowledgeIds))
        .all()
    : db()
        .select()
        .from(chronicleKnowledgeCards)
        .orderBy(desc(chronicleKnowledgeCards.updatedAt))
        .limit(input.limit)
        .all()
  return rows
    .filter(card => card.status === input.status)
    .slice(0, input.limit)
}

function runDreamLifecycleOperation(input: {
  runId: string
  runType: Extract<DreamRunType, 'archive' | 'prune' | 'restore'>
  dryRun: boolean
  limit: number
  olderThanDays: number
  knowledgeIds: string[]
  now: number
}): DreamRunEntry {
  const sourceStatus: KnowledgeCardStatus = input.runType === 'restore' ? 'archived' : input.runType === 'prune' ? 'archived' : 'active'
  const targetStatus: KnowledgeCardStatus = input.runType === 'restore' ? 'active' : input.runType === 'prune' ? 'deleted' : 'archived'
  const cutoff = input.now - input.olderThanDays * 86_400
  const cards = selectDreamKnowledgeCards({
    status: sourceStatus,
    limit: input.limit,
    knowledgeIds: input.knowledgeIds,
  }).filter((card) => {
    if (input.knowledgeIds.length > 0 || input.runType === 'restore') {
      return true
    }
    return !card.pinned && card.updatedAt <= cutoff
  })

  const result = db().transaction((tx) => {
    const changedKnowledgeIds: string[] = []
    for (const card of cards) {
      if (!input.dryRun) {
        updateDreamLifecycleKnowledgeCard(tx, {
          card,
          runType: input.runType,
          targetStatus,
          runId: input.runId,
          now: input.now,
        })
        changedKnowledgeIds.push(card.id)
      }
      tx.insert(chronicleDreamCandidates).values({
        id: randomUUID(),
        runId: input.runId,
        workspaceId: card.workspaceId,
        candidateType: input.runType,
        scoreBps: input.dryRun ? 0 : 10_000,
        sourceKnowledgeIdsJson: JSON.stringify([card.id]),
        proposedTitle: card.title,
        proposedContent: card.content,
        proposedCardType: card.cardType,
        proposedDimension: card.dimension,
        outputKnowledgeId: input.runType === 'prune' ? null : card.id,
        status: input.dryRun ? 'proposed' : 'applied',
        reason: buildDreamLifecycleReason(input.runType, sourceStatus, targetStatus, input.olderThanDays),
        metadataJson: JSON.stringify({
          sourceStatus,
          targetStatus,
          dryRun: input.dryRun,
          olderThanDays: input.olderThanDays,
        }),
        createdAt: input.now,
        updatedAt: input.now,
      }).run()
    }
    tx.update(chronicleDreamRuns).set({
      status: 'completed',
      endedAt: input.now,
      inputCount: cards.length,
      outputCount: input.runType === 'prune' ? 0 : changedKnowledgeIds.length,
      mergedCount: 0,
      deletedCount: input.runType === 'prune' && !input.dryRun ? changedKnowledgeIds.length : 0,
      sourceKnowledgeIdsJson: JSON.stringify(cards.map(card => card.id)),
      outputKnowledgeIdsJson: JSON.stringify(input.runType === 'prune' ? [] : changedKnowledgeIds),
      resultJson: JSON.stringify({
        dryRun: input.dryRun,
        candidateCount: cards.length,
        changedCount: changedKnowledgeIds.length,
        sourceStatus,
        targetStatus,
        olderThanDays: input.olderThanDays,
      }),
      updatedAt: input.now,
    }).where(eq(chronicleDreamRuns.id, input.runId)).run()
    return tx.select().from(chronicleDreamRuns).where(eq(chronicleDreamRuns.id, input.runId)).get()!
  })
  recordEvent({
    type: 'activity',
    status: 'success',
    message: input.dryRun
      ? `Chronicle dream ${input.runType} dry run completed`
      : `Chronicle dream ${input.runType} completed`,
    attrs: { runId: input.runId, candidateCount: cards.length, dryRun: input.dryRun },
  })
  return toDreamRunEntry(result)
}

function updateDreamLifecycleKnowledgeCard(
  tx: ChronicleTx,
  input: {
    card: typeof chronicleKnowledgeCards.$inferSelect
    runType: Extract<DreamRunType, 'archive' | 'prune' | 'restore'>
    targetStatus: KnowledgeCardStatus
    runId: string
    now: number
  },
): void {
  const nextVersion = input.card.version + 1
  tx.update(chronicleKnowledgeCards).set({
    version: nextVersion,
    status: input.targetStatus,
    mergedIntoId: input.runType === 'restore' ? null : input.card.mergedIntoId,
    updatedAt: input.now,
    metadataJson: JSON.stringify({
      ...JsonRecordTextSchema.parse(input.card.metadataJson),
      lastDreamRunId: input.runId,
      lastDreamAction: input.runType,
      previousStatus: input.card.status,
    }),
  }).where(eq(chronicleKnowledgeCards.id, input.card.id)).run()
  tx.insert(chronicleKnowledgeVersions).values({
    id: randomUUID(),
    knowledgeId: input.card.id,
    version: nextVersion,
    title: input.card.title,
    content: input.card.content,
    cardType: input.card.cardType,
    dimension: input.card.dimension,
    confidenceBps: input.card.confidenceBps,
    sourceMemoryIdsJson: input.card.sourceMemoryIdsJson,
    sourceSegmentIdsJson: input.card.sourceSegmentIdsJson,
    sourceChunkIdsJson: input.card.sourceChunkIdsJson,
    tagsJson: input.card.tagsJson,
    metadataJson: JSON.stringify({
      source: `dream-${input.runType}`,
      runId: input.runId,
      previousStatus: input.card.status,
      status: input.targetStatus,
    }),
    createdAt: input.now,
  }).run()
}

function buildDreamLifecycleReason(
  runType: Extract<DreamRunType, 'archive' | 'prune' | 'restore'>,
  sourceStatus: KnowledgeCardStatus,
  targetStatus: KnowledgeCardStatus,
  olderThanDays: number,
): string {
  if (runType === 'restore') {
    return `Restore ${sourceStatus} knowledge card to ${targetStatus}`
  }
  return `Move ${sourceStatus} knowledge card to ${targetStatus} after ${olderThanDays} days`
}

export async function triageActivitySegment(segmentId: string): Promise<ActivityPipelineActionResult> {
  const context = getActivitySegmentContext(segmentId)
  const evidenceHash = buildActivityEvidenceHash(context)
  const sourceKey = `activity-segment:${segmentId}:triage:${evidenceHash}`
  const completed = getCompletedActivityPipelineRun(sourceKey, context.segment.id)
  if (completed) {
    return completed
  }
  const now = currentUnixSeconds()
  const run = upsertActivityPipelineRun({
    sourceKey,
    segment: context.segment,
    stage: 'triage',
    status: 'running',
    startedAt: now,
    metadata: { evidenceCounts: context.evidenceCounts, evidenceHash },
  })
  const config = await getConfig()
  const modelContextResult = resolveChronicleLanguageModelContext(config)
  if (!modelContextResult.ok) {
    return failActivityPipelineRun(context.segment.id, run.id, 'triage', modelContextResult.message)
  }
  const modelContext = modelContextResult.context

  try {
    const prompt = buildActivityTriagePrompt(context)
    const result = await generateChronicleText({
      modelContext,
      prompt,
      stage: 'triage',
    })
    const triage = ActivityTriageModelTextSchema.parse(result.text)
    const endedAt = currentUnixSeconds()
    const metadata = {
      ...JsonRecordTextSchema.parse(context.segment.metadataJson),
      triage: {
        keep: triage.keep,
        reason: triage.reason,
        priority: triage.priority,
        modelId: modelContext.modelId,
        profileId: modelContext.profileId,
        evidenceHash,
        completedAt: endedAt,
      },
    }
    db().update(chronicleActivitySegments).set({
      segmentType: triage.segmentType,
      title: triage.title ?? context.segment.title,
      pipelineStatus: 'triaged',
      metadataJson: JSON.stringify(metadata),
      updatedAt: endedAt,
    }).where(eq(chronicleActivitySegments.id, context.segment.id)).run()

    db().update(chroniclePipelineRuns).set({
      status: triage.keep ? 'success' : 'skipped',
      endedAt,
      errorMessage: null,
      triageResultsJson: JSON.stringify({
        ...triage,
        rawText: result.text,
        usage: normalizeLanguageModelUsage(result.usage),
      }),
      metadataJson: JSON.stringify({
        evidenceCounts: context.evidenceCounts,
        evidenceHash,
        modelId: modelContext.modelId,
        profileId: modelContext.profileId,
      }),
      updatedAt: endedAt,
    }).where(eq(chroniclePipelineRuns.id, run.id)).run()

    recordEvent({
      type: 'activity',
      status: triage.keep ? 'success' : 'info',
      message: triage.keep ? 'Chronicle activity segment triaged' : 'Chronicle activity segment skipped by triage',
      attrs: { segmentId: context.segment.id, runId: run.id, reason: triage.reason },
    })

    return {
      segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, context.segment.id)).get()!),
      run: toPipelineRunEntry(db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, run.id)).get()!),
      memoryId: null,
      status: triage.keep ? 'success' : 'skipped',
      message: triage.reason,
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failActivityPipelineRun(context.segment.id, run.id, 'triage', message)
  }
}

export async function summarizeActivitySegment(segmentId: string): Promise<ActivityPipelineActionResult> {
  const triageResult = await triageActivitySegment(segmentId)
  if (triageResult.status === 'error') {
    return triageResult
  }
  if (triageResult.status === 'skipped') {
    return triageResult
  }

  const context = getActivitySegmentContext(segmentId)
  const evidenceHash = buildActivityEvidenceHash(context)
  const sourceKey = `activity-segment:${segmentId}:summarization:${evidenceHash}`
  const completed = getCompletedActivityPipelineRun(sourceKey, context.segment.id)
  if (completed) {
    return completed
  }
  const now = currentUnixSeconds()
  const run = upsertActivityPipelineRun({
    sourceKey,
    segment: context.segment,
    stage: 'summarization',
    status: 'running',
    startedAt: now,
    metadata: { evidenceCounts: context.evidenceCounts, evidenceHash },
  })
  const config = await getConfig()
  const modelContextResult = resolveChronicleLanguageModelContext(config)
  if (!modelContextResult.ok) {
    return failActivityPipelineRun(context.segment.id, run.id, 'summarization', modelContextResult.message)
  }
  const modelContext = modelContextResult.context

  try {
    const prompt = buildActivitySummaryPrompt(context)
    const result = await generateChronicleText({
      modelContext,
      prompt,
      stage: 'summarization',
    })
    const summary = ActivitySummaryModelTextSchema.parse(result.text)
    const usage = normalizeLanguageModelUsage(result.usage)
    const memory = recordMemory({
      sourceId: `activity-segment:${segmentId}:summary`,
      windowType: '10min',
      createdAt: new Date(context.segment.endedAt * 1000).toISOString(),
      content: buildActivitySummaryMemoryContent(context, summary),
      summaryKind: 'llm',
      metadata: {
        source: 'activity-segment-summary',
        segmentId,
        title: summary.title,
        keyPoints: summary.keyPoints,
        entities: summary.entities,
        followUps: summary.followUps,
      },
    }, {
      prompt,
      modelId: modelContext.modelId,
      profileId: modelContext.profileId,
      usage,
      sourceSnapshotIds: context.sourceRefs.snapshotIds,
      skipActivityAssignment: true,
    })
    const endedAt = currentUnixSeconds()
    const metadata = {
      ...JsonRecordTextSchema.parse(context.segment.metadataJson),
      summarization: {
        memoryId: memory.id,
        modelId: modelContext.modelId,
        profileId: modelContext.profileId,
        evidenceHash,
        completedAt: endedAt,
      },
    }
    db().update(chronicleActivitySegments).set({
      title: summary.title || context.segment.title,
      summary: summary.summary,
      pipelineStatus: 'summarized',
      metadataJson: JSON.stringify(metadata),
      updatedAt: endedAt,
    }).where(eq(chronicleActivitySegments.id, context.segment.id)).run()
    db().update(chroniclePipelineRuns).set({
      status: 'success',
      endedAt,
      errorMessage: null,
      memoryIdsJson: JSON.stringify([memory.id]),
      memoriesCount: 1,
      summaryResultsJson: JSON.stringify({
        ...summary,
        memoryId: memory.id,
        rawText: result.text,
        usage,
      }),
      metadataJson: JSON.stringify({
        evidenceCounts: context.evidenceCounts,
        evidenceHash,
        modelId: modelContext.modelId,
        profileId: modelContext.profileId,
      }),
      updatedAt: endedAt,
    }).where(eq(chroniclePipelineRuns.id, run.id)).run()
    recordEvent({
      type: 'activity',
      status: 'success',
      message: 'Chronicle activity segment summarized',
      memoryId: memory.id,
      attrs: { segmentId, runId: run.id, modelId: modelContext.modelId },
    })
    return {
      segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, context.segment.id)).get()!),
      run: toPipelineRunEntry(db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, run.id)).get()!),
      memoryId: memory.id,
      status: 'success',
      message: 'Activity segment summarized',
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failActivityPipelineRun(context.segment.id, run.id, 'summarization', message)
  }
}

export async function crystallizeActivitySegment(segmentId: string): Promise<ActivityPipelineActionResult> {
  const currentSegment = db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()
  if (!currentSegment) {
    throw new AppError({ code: 'chronicle_activity_segment_not_found', status: 404, message: 'Chronicle activity segment not found' })
  }
  if (!currentSegment.summary && currentSegment.pipelineStatus !== 'crystallized') {
    const summaryResult = await summarizeActivitySegment(segmentId)
    if (summaryResult.status !== 'success') {
      return summaryResult
    }
  }

  const context = getActivitySegmentContext(segmentId)
  const evidenceHash = buildActivityCrystallizationEvidenceHash(context)
  const sourceKey = `activity-segment:${segmentId}:crystallization:${evidenceHash}`
  const completed = getCompletedCrystallizationRun(sourceKey, context.segment.id)
  if (completed) {
    return completed
  }

  const now = currentUnixSeconds()
  const run = upsertActivityPipelineRun({
    sourceKey,
    segment: context.segment,
    stage: 'crystallization',
    status: 'running',
    startedAt: now,
    metadata: { evidenceCounts: context.evidenceCounts, evidenceHash },
  })
  const config = await getConfig()
  const modelContextResult = resolveChronicleLanguageModelContext(config)
  if (!modelContextResult.ok) {
    return failActivityPipelineRun(context.segment.id, run.id, 'crystallization', modelContextResult.message)
  }
  const modelContext = modelContextResult.context

  try {
    const prompt = buildActivityCrystallizationPrompt(context)
    const result = await generateChronicleText({
      modelContext,
      prompt,
      stage: 'crystallization',
    })
    const parsed = ActivityCrystallizationModelTextSchema.parse(result.text)
    const usage = normalizeLanguageModelUsage(result.usage)
    const endedAt = currentUnixSeconds()
    const memoryIds = getActivityCrystallizationMemoryIds(context)

    const cards = db().transaction((tx) => {
      const writtenCards: Array<typeof chronicleKnowledgeCards.$inferSelect> = []
      const versionIds: string[] = []

      for (const draft of parsed.knowledgeCards) {
        const written = upsertKnowledgeCardFromDraft(tx, {
          draft,
          context,
          runId: run.id,
          modelId: modelContext.modelId,
          profileId: modelContext.profileId,
          evidenceHash,
          memoryIds,
          now: endedAt,
        })
        writtenCards.push(written.card)
        versionIds.push(written.versionId)
      }

      const metadata = {
        ...JsonRecordTextSchema.parse(context.segment.metadataJson),
        crystallization: {
          knowledgeCardIds: writtenCards.map(card => card.id),
          modelId: modelContext.modelId,
          profileId: modelContext.profileId,
          evidenceHash,
          completedAt: endedAt,
        },
      }
      tx.update(chronicleActivitySegments).set({
        pipelineStatus: writtenCards.length > 0 ? 'crystallized' : context.segment.pipelineStatus,
        isCrystallized: writtenCards.length > 0,
        metadataJson: JSON.stringify(metadata),
        updatedAt: endedAt,
      }).where(eq(chronicleActivitySegments.id, context.segment.id)).run()
      tx.update(chroniclePipelineRuns).set({
        status: writtenCards.length > 0 ? 'success' : 'skipped',
        endedAt,
        errorMessage: null,
        memoryIdsJson: JSON.stringify(memoryIds),
        memoriesCount: memoryIds.length,
        segmentIdsJson: JSON.stringify([context.segment.id]),
        segmentsCount: 1,
        summaryResultsJson: JSON.stringify({
          summary: parsed.summary,
          knowledgeCardIds: writtenCards.map(card => card.id),
          versionIds,
          rejectedCount: parsed.rejectedCount,
          rawText: result.text.slice(0, 16_000),
          usage,
        }),
        metadataJson: JSON.stringify({
          evidenceCounts: context.evidenceCounts,
          evidenceHash,
          modelId: modelContext.modelId,
          profileId: modelContext.profileId,
          promptHash: hashText(prompt),
          promptVersion: 'chronicle-crystallization-v1',
        }),
        updatedAt: endedAt,
      }).where(eq(chroniclePipelineRuns.id, run.id)).run()

      return writtenCards.map(toKnowledgeCardEntry)
    })

    recordEvent({
      type: 'activity',
      status: cards.length > 0 ? 'success' : 'info',
      message: cards.length > 0 ? 'Chronicle activity segment crystallized' : 'Chronicle activity segment produced no knowledge cards',
      attrs: { segmentId, runId: run.id, knowledgeCardIds: cards.map(card => card.id) },
    })

    return {
      segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, context.segment.id)).get()!),
      run: toPipelineRunEntry(db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, run.id)).get()!),
      memoryId: memoryIds[0] ?? null,
      knowledgeCards: cards,
      status: cards.length > 0 ? 'success' : 'skipped',
      message: cards.length > 0 ? 'Activity segment crystallized' : 'No durable knowledge cards were produced',
    }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failActivityPipelineRun(context.segment.id, run.id, 'crystallization', message)
  }
}

function getCompletedActivityPipelineRun(
  sourceKey: string,
  segmentId: string,
): ActivityPipelineActionResult | null {
  const run = db()
    .select()
    .from(chroniclePipelineRuns)
    .where(eq(chroniclePipelineRuns.sourceKey, sourceKey))
    .get()
  if (!run || (run.status !== 'success' && run.status !== 'skipped')) {
    return null
  }
  const memoryIds = ActivityPipelineMemoryIdsJsonSchema.parse(run.memoryIdsJson)
  return {
    segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()!),
    run: toPipelineRunEntry(run),
    memoryId: memoryIds[0] ?? null,
    status: run.status,
    message: run.status === 'skipped' ? 'Activity segment was already skipped' : 'Activity pipeline result already exists',
  }
}

function getCompletedCrystallizationRun(
  sourceKey: string,
  segmentId: string,
): ActivityPipelineActionResult | null {
  const run = db()
    .select()
    .from(chroniclePipelineRuns)
    .where(eq(chroniclePipelineRuns.sourceKey, sourceKey))
    .get()
  if (!run || (run.status !== 'success' && run.status !== 'skipped')) {
    return null
  }
  const result = ActivityCrystallizationRunResultJsonSchema.parse(run.summaryResultsJson)
  const knowledgeCardIds = result.knowledgeCardIds
  const cards = knowledgeCardIds.length === 0
    ? []
    : db()
        .select()
        .from(chronicleKnowledgeCards)
        .where(inArray(chronicleKnowledgeCards.id, knowledgeCardIds))
        .all()
        .map(toKnowledgeCardEntry)
  const memoryIds = ActivityPipelineMemoryIdsJsonSchema.parse(run.memoryIdsJson)
  return {
    segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()!),
    run: toPipelineRunEntry(run),
    memoryId: memoryIds[0] ?? null,
    knowledgeCards: cards,
    status: run.status,
    message: run.status === 'skipped' ? 'Activity crystallization produced no cards' : 'Activity crystallization result already exists',
  }
}

function getActivitySegmentContext(segmentId: string): ActivitySegmentContext {
  const segment = db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()
  if (!segment) {
    throw new AppError({ code: 'chronicle_activity_segment_not_found', status: 404, message: 'Chronicle activity segment not found' })
  }
  const sourceRefs = ActivitySourceRefsJsonSchema.parse(segment.sourceRefsJson)
  const rawEvidenceText = [
    `Segment: ${segment.title ?? 'Untitled activity'}`,
    `Type: ${segment.segmentType}`,
    `Window: ${segment.frontApp ?? 'unknown'} / ${segment.title ?? 'unknown'}`,
    `Time: ${new Date(segment.startedAt * 1000).toISOString()} - ${new Date(segment.endedAt * 1000).toISOString()}`,
    `Existing summary: ${segment.summary ?? ''}`,
    buildSnapshotEvidenceText(sourceRefs.snapshotIds),
    buildAccessibilityEvidenceText(sourceRefs.accessibilitySnapshotIds),
    buildSlackEvidenceText(sourceRefs.messageIds),
    buildAudioTranscriptEvidenceText(sourceRefs.audioTranscriptIds),
    buildAudioRawEvidenceText(sourceRefs.audioRawSegmentIds),
    buildMemoryEvidenceText(sourceRefs.memoryIds),
  ].filter(section => section.trim().length > 0).join('\n\n')
  const evidenceText = redactActivityEvidenceText(rawEvidenceText)

  return {
    segment,
    sourceRefs,
    evidenceText,
    evidenceCounts: countActivitySourceRefs(sourceRefs),
  }
}

function redactActivityEvidenceText(text: string): string {
  return [
    redactApiKeys,
    redactEmails,
    redactSsns,
    redactCreditCards,
    redactPhoneNumbers,
    redactIpv4Addresses,
  ].reduce((value, redact) => redact(value), text)
}

function redactApiKeys(text: string): string {
  return text
    .replace(/\bsk-[\w-]{8,}\b/g, '[API_KEY]')
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{8,}\b/g, '[API_KEY]')
    .replace(/\b(?:ghp|github_pat|glpat|hf)_[\w-]{12,}\b/g, '[API_KEY]')
}

function redactEmails(text: string): string {
  return text.replace(/\b[\w.%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
}

function redactSsns(text: string): string {
  return text.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]')
}

function redactCreditCards(text: string): string {
  return text.replace(/\b(?:\d[ -]*?){13,19}\b/g, (candidate) => {
    const digits = candidate.replace(/\D/g, '')
    return isLikelyCreditCardNumber(digits) ? '[CREDIT_CARD]' : candidate
  })
}

function redactPhoneNumbers(text: string): string {
  return text.replace(/(?<!\w)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[PHONE_NUMBER]')
}

function redactIpv4Addresses(text: string): string {
  return text.replace(/\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g, '[IP_ADDRESS]')
}

function buildSnapshotEvidenceText(snapshotIds: string[]): string {
  const ids = uniqueStrings(snapshotIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleSnapshots)
    .where(inArray(chronicleSnapshots.id, ids))
    .orderBy(chronicleSnapshots.capturedAt)
    .all()
    .map(row => [
      `[Snapshot ${new Date(row.capturedAt * 1000).toISOString()}]`,
      `App: ${row.appBundleId ?? 'unknown'}`,
      `Title: ${row.windowTitle ?? 'unknown'}`,
      `OCR: ${row.ocrText ?? ''}`,
    ].join('\n'))
    .join('\n\n')
}

function buildAccessibilityEvidenceText(accessibilitySnapshotIds: string[]): string {
  const ids = uniqueStrings(accessibilitySnapshotIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleAccessibilitySnapshots)
    .where(inArray(chronicleAccessibilitySnapshots.id, ids))
    .orderBy(chronicleAccessibilitySnapshots.capturedAt)
    .all()
    .map(row => [
      `[Accessibility ${new Date(row.capturedAt * 1000).toISOString()}]`,
      `Status: ${row.status}`,
      `Provider: ${row.provider}`,
      `Text: ${row.text ?? ''}`,
    ].join('\n'))
    .join('\n\n')
}

function buildSlackEvidenceText(messageIds: string[]): string {
  const ids = uniqueStrings(messageIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleMessages)
    .where(inArray(chronicleMessages.id, ids))
    .orderBy(chronicleMessages.messageAt)
    .all()
    .map(row => `[Slack ${row.channelName ?? row.channelId} ${new Date(row.messageAt * 1000).toISOString()}] ${row.userName ?? row.userId ?? 'unknown'}: ${row.text}`)
    .join('\n')
}

function buildAudioTranscriptEvidenceText(audioTranscriptIds: string[]): string {
  const ids = uniqueStrings(audioTranscriptIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleAudioTranscripts)
    .where(inArray(chronicleAudioTranscripts.id, ids))
    .orderBy(chronicleAudioTranscripts.startedAt)
    .all()
    .map(row => [
      `[Audio Transcript ${new Date(row.startedAt * 1000).toISOString()}]`,
      `Title: ${row.title ?? row.windowTitle ?? 'Untitled transcript'}`,
      `Text: ${buildAudioTranscriptPreview(row.id)}`,
    ].join('\n'))
    .join('\n\n')
}

function buildAudioRawEvidenceText(audioRawSegmentIds: string[]): string {
  const ids = uniqueStrings(audioRawSegmentIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleAudioRawSegments)
    .where(inArray(chronicleAudioRawSegments.id, ids))
    .orderBy(chronicleAudioRawSegments.recordedAt)
    .all()
    .map(row => [
      `[Raw Audio ${new Date(row.recordedAt * 1000).toISOString()}]`,
      `Source: ${row.source}`,
      `Active: ${row.active}`,
      `Duration: ${row.durationMs}ms`,
      `RMS: ${bpsToRatio(row.rmsBps)}`,
    ].join('\n'))
    .join('\n\n')
}

function buildMemoryEvidenceText(memoryIds: string[]): string {
  const ids = uniqueStrings(memoryIds)
  if (ids.length === 0) {
    return ''
  }
  return db()
    .select()
    .from(chronicleMemories)
    .where(inArray(chronicleMemories.id, ids))
    .orderBy(chronicleMemories.createdAt)
    .all()
    .map(row => `[Memory ${new Date(row.createdAt * 1000).toISOString()} ${row.source}] ${row.content}`)
    .join('\n\n')
}

function buildActivityEvidenceHash(context: ActivitySegmentContext): string {
  return hashText(JSON.stringify({
    segmentId: context.segment.id,
    startedAt: context.segment.startedAt,
    endedAt: context.segment.endedAt,
    sourceRefs: normalizeActivityEvidenceRefs(context.sourceRefs),
    sourceVersions: buildActivityEvidenceSourceVersions(context.sourceRefs),
  })).slice(0, 24)
}

function buildActivityCrystallizationEvidenceHash(context: ActivitySegmentContext): string {
  return hashText(JSON.stringify({
    activityEvidenceHash: buildActivityEvidenceHash(context),
    summaryMemoryVersions: buildActivityCrystallizationMemoryVersions(context),
  })).slice(0, 24)
}

function buildActivityCrystallizationMemoryVersions(context: ActivitySegmentContext): Array<{ id: string, updatedAt: number }> {
  const memoryIds = getActivityCrystallizationMemoryIds(context)
  if (memoryIds.length === 0) {
    return []
  }
  return db()
    .select({ id: chronicleMemories.id, updatedAt: chronicleMemories.updatedAt })
    .from(chronicleMemories)
    .where(inArray(chronicleMemories.id, memoryIds))
    .all()
    .sort(compareActivityEvidenceVersion)
}

function getActivityCrystallizationMemoryIds(context: ActivitySegmentContext): string[] {
  const sourceRefs = ActivitySourceRefsSchema.parse(context.sourceRefs)
  const metadata = ActivitySegmentMetadataJsonSchema.parse(context.segment.metadataJson)
  return uniqueStrings([
    ...sourceRefs.memoryIds,
    ...(metadata.summarization.memoryId ? [metadata.summarization.memoryId] : []),
  ])
}

function normalizeActivityEvidenceRefs(sourceRefs: Record<string, string[]>): Record<string, string[]> {
  const entries: Array<[string, string[]]> = Object.entries(sourceRefs)
    .map(([key, values]) => [key, uniqueStrings(values).sort()])
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)))
}

function buildActivityEvidenceSourceVersions(sourceRefs: Record<string, string[]>): Record<string, Array<{ id: string, updatedAt: number }>> {
  const refs = ActivitySourceRefsSchema.parse(sourceRefs)
  return {
    snapshotIds: readActivityEvidenceVersions('snapshotIds', refs.snapshotIds),
    accessibilitySnapshotIds: readActivityEvidenceVersions('accessibilitySnapshotIds', refs.accessibilitySnapshotIds),
    messageIds: readActivityEvidenceVersions('messageIds', refs.messageIds),
    audioTranscriptIds: readActivityEvidenceVersions('audioTranscriptIds', refs.audioTranscriptIds),
    audioRawSegmentIds: readActivityEvidenceVersions('audioRawSegmentIds', refs.audioRawSegmentIds),
    memoryIds: readActivityEvidenceVersions('memoryIds', refs.memoryIds),
  }
}

function readActivityEvidenceVersions(
  kind: 'snapshotIds' | 'accessibilitySnapshotIds' | 'messageIds' | 'audioTranscriptIds' | 'audioRawSegmentIds' | 'memoryIds',
  ids: string[],
): Array<{ id: string, updatedAt: number }> {
  const uniqueIds = uniqueStrings(ids)
  if (uniqueIds.length === 0) {
    return []
  }
  if (kind === 'snapshotIds') {
    return db().select({ id: chronicleSnapshots.id, updatedAt: chronicleSnapshots.updatedAt }).from(chronicleSnapshots).where(inArray(chronicleSnapshots.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
  }
  if (kind === 'accessibilitySnapshotIds') {
    return db().select({ id: chronicleAccessibilitySnapshots.id, updatedAt: chronicleAccessibilitySnapshots.updatedAt }).from(chronicleAccessibilitySnapshots).where(inArray(chronicleAccessibilitySnapshots.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
  }
  if (kind === 'messageIds') {
    return db().select({ id: chronicleMessages.id, updatedAt: chronicleMessages.updatedAt }).from(chronicleMessages).where(inArray(chronicleMessages.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
  }
  if (kind === 'audioTranscriptIds') {
    return db().select({ id: chronicleAudioTranscripts.id, updatedAt: chronicleAudioTranscripts.updatedAt }).from(chronicleAudioTranscripts).where(inArray(chronicleAudioTranscripts.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
  }
  if (kind === 'audioRawSegmentIds') {
    return db().select({ id: chronicleAudioRawSegments.id, updatedAt: chronicleAudioRawSegments.updatedAt }).from(chronicleAudioRawSegments).where(inArray(chronicleAudioRawSegments.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
  }
  return db().select({ id: chronicleMemories.id, updatedAt: chronicleMemories.updatedAt }).from(chronicleMemories).where(inArray(chronicleMemories.id, uniqueIds)).all().sort(compareActivityEvidenceVersion)
}

function compareActivityEvidenceVersion(
  left: { id: string, updatedAt: number },
  right: { id: string, updatedAt: number },
): number {
  return left.id.localeCompare(right.id)
}

function upsertActivityPipelineRun(input: {
  sourceKey: string
  segment: typeof chronicleActivitySegments.$inferSelect
  stage: ActivityPipelineStage
  status: ActivityPipelineRunStatus
  startedAt: number
  metadata: Record<string, unknown>
}): typeof chroniclePipelineRuns.$inferSelect {
  const now = currentUnixSeconds()
  const sourceRefs = ActivitySourceRefsJsonSchema.parse(input.segment.sourceRefsJson)
  const values = {
    sessionId: input.segment.sessionId,
    segmentId: input.segment.id,
    workspaceId: input.segment.workspaceId,
    trigger: input.stage === 'summarization' ? 'summarize' as const : 'manual' as const,
    sourceKey: input.sourceKey,
    stage: input.stage,
    status: input.status,
    startedAt: input.startedAt,
    endedAt: null,
    errorMessage: null,
    snapshotIdsJson: JSON.stringify(sourceRefs.snapshotIds),
    messageIdsJson: JSON.stringify(sourceRefs.messageIds),
    audioTranscriptIdsJson: JSON.stringify(sourceRefs.audioTranscriptIds),
    audioRawSegmentIdsJson: JSON.stringify(sourceRefs.audioRawSegmentIds),
    memoryIdsJson: JSON.stringify(sourceRefs.memoryIds),
    segmentIdsJson: JSON.stringify([input.segment.id]),
    snapshotsCount: sourceRefs.snapshotIds.length,
    messagesCount: sourceRefs.messageIds.length,
    audioTranscriptsCount: sourceRefs.audioTranscriptIds.length,
    audioRawSegmentsCount: sourceRefs.audioRawSegmentIds.length,
    memoriesCount: sourceRefs.memoryIds.length,
    segmentsCount: 1,
    metadataJson: JSON.stringify(input.metadata),
    updatedAt: now,
  }
  const existing = db()
    .select()
    .from(chroniclePipelineRuns)
    .where(eq(chroniclePipelineRuns.sourceKey, input.sourceKey))
    .get()
  if (existing) {
    db().update(chroniclePipelineRuns).set(values).where(eq(chroniclePipelineRuns.id, existing.id)).run()
    return db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, existing.id)).get()!
  }
  const id = randomUUID()
  db().insert(chroniclePipelineRuns).values({
    id,
    ...values,
    triageResultsJson: '{}',
    summaryResultsJson: '{}',
    createdAt: now,
  }).run()
  return db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, id)).get()!
}

function failActivityPipelineRun(
  segmentId: string,
  runId: string,
  stage: ActivityPipelineStage,
  message: string,
): ActivityPipelineActionResult {
  const endedAt = currentUnixSeconds()
  db().update(chronicleActivitySegments).set({
    pipelineStatus: 'error',
    updatedAt: endedAt,
  }).where(eq(chronicleActivitySegments.id, segmentId)).run()
  db().update(chroniclePipelineRuns).set({
    status: 'error',
    endedAt,
    errorMessage: message,
    updatedAt: endedAt,
  }).where(eq(chroniclePipelineRuns.id, runId)).run()
  recordEvent({
    type: 'activity',
    status: 'error',
    message,
    attrs: { segmentId, runId, stage },
  })
  return {
    segment: toActivitySegmentEntry(db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, segmentId)).get()!),
    run: toPipelineRunEntry(db().select().from(chroniclePipelineRuns).where(eq(chroniclePipelineRuns.id, runId)).get()!),
    memoryId: null,
    status: 'error',
    message,
  }
}

function buildActivityTriagePrompt(context: ActivitySegmentContext): string {
  return [
    'You are Cradle Chronicle triage. Decide whether this desktop activity segment is worth keeping as long-term memory.',
    'Return only compact JSON with keys: keep boolean, reason string, segmentType one of work|meeting|browsing|chat|audio|idle|unknown, title string|null, priority one of low|normal|high.',
    'Keep useful project work, decisions, meetings, Slack coordination, debugging, and concrete user intent. Skip idle, empty, duplicated, or privacy-sensitive noise.',
    '',
    context.evidenceText.slice(0, 16_000),
  ].join('\n')
}

function buildActivitySummaryPrompt(context: ActivitySegmentContext): string {
  return [
    'You are Cradle Chronicle crystallization. Turn this activity segment into a concise structured memory for future agent search.',
    'Return only compact JSON with keys: title string, summary string, keyPoints string[], entities string[], followUps string[].',
    'Prefer factual details, decisions, artifacts, blockers, file names, channels, and next actions. Do not invent missing facts.',
    '',
    context.evidenceText.slice(0, 20_000),
  ].join('\n')
}

function buildActivityCrystallizationPrompt(context: ActivitySegmentContext): string {
  return [
    'You are Cradle Chronicle knowledge crystallization. Convert this activity segment into durable knowledge cards for future agent search.',
    'Return only compact JSON with keys: summary string, knowledgeCards array, rejectedCount number.',
    'Each knowledgeCards item must contain: title string, content string, type one of fact|insight|decision|task|pattern, dimension one of technical|business|personal|project|general, confidence number between 0 and 1, tags string[], stableKey string.',
    'Use stableKey as a short deterministic identity for the same future fact. Prefer project/file/decision nouns over timestamps. Do not invent missing facts.',
    '',
    context.evidenceText.slice(0, 24_000),
  ].join('\n')
}

function buildActivitySummaryMemoryContent(context: ActivitySegmentContext, summary: ActivitySummaryResult): string {
  const parts = [
    `Activity: ${summary.title}`,
    '',
    summary.summary,
  ]
  if (summary.keyPoints.length > 0) {
    parts.push('', 'Key points:', ...summary.keyPoints.map(point => `- ${point}`))
  }
  if (summary.followUps.length > 0) {
    parts.push('', 'Follow-ups:', ...summary.followUps.map(item => `- ${item}`))
  }
  if (summary.entities.length > 0) {
    parts.push('', `Entities: ${summary.entities.join(', ')}`)
  }
  parts.push('', `Source segment: ${context.segment.id}`)
  return parts.join('\n').trim()
}

function upsertKnowledgeCardFromDraft(
  tx: ChronicleTx,
  input: {
    draft: CrystallizedKnowledgeCardDraft
    context: ActivitySegmentContext
    runId: string
    modelId: string
    profileId: string
    evidenceHash: string
    memoryIds: string[]
    now: number
  },
): { card: typeof chronicleKnowledgeCards.$inferSelect, versionId: string } {
  const contentHash = hashText(canonicalizeMemoryContent(`${input.draft.title}\n${input.draft.content}`))
  const existing = tx
    .select()
    .from(chronicleKnowledgeCards)
    .where(eq(chronicleKnowledgeCards.stableKey, input.draft.stableKey))
    .all()
    .find(row => row.workspaceId === input.context.segment.workspaceId && row.status !== 'deleted')
  const sourceSegmentIds = uniqueStrings([
    ...(existing ? StringListTextSchema.parse(existing.sourceSegmentIdsJson) : []),
    input.context.segment.id,
  ])
  const sourceMemoryIds = uniqueStrings([
    ...(existing ? StringListTextSchema.parse(existing.sourceMemoryIdsJson) : []),
    ...input.memoryIds,
  ])
  const sourceChunkIds = existing ? StringListTextSchema.parse(existing.sourceChunkIdsJson) : []
  const tags = uniqueStrings([
    ...(existing ? StringListTextSchema.parse(existing.tagsJson) : []),
    ...input.draft.tags,
  ]).slice(0, 24)
  const previousMetadata = existing ? JsonRecordTextSchema.parse(existing.metadataJson) : {}
  const metadata = {
    ...previousMetadata,
    stableKey: input.draft.stableKey,
    lastEvidenceHash: input.evidenceHash,
    lastPipelineRunId: input.runId,
    lastModelId: input.modelId,
    lastProfileId: input.profileId,
    updatedBy: 'activity-crystallization',
  }

  let knowledgeId = existing?.id ?? randomUUID()
  let version = existing?.version ?? 0
  const materialChanged = !existing
    || existing.title !== input.draft.title
    || existing.content !== input.draft.content
    || existing.cardType !== input.draft.cardType
    || existing.dimension !== input.draft.dimension
    || existing.confidenceBps !== input.draft.confidenceBps
    || existing.contentHash !== contentHash

  if (!existing) {
    version = 1
    tx.insert(chronicleKnowledgeCards).values({
      id: knowledgeId,
      workspaceId: input.context.segment.workspaceId,
      title: input.draft.title,
      content: input.draft.content,
      cardType: input.draft.cardType,
      dimension: input.draft.dimension,
      confidenceBps: input.draft.confidenceBps,
      sourceMemoryIdsJson: JSON.stringify(sourceMemoryIds),
      sourceSegmentIdsJson: JSON.stringify(sourceSegmentIds),
      sourceChunkIdsJson: JSON.stringify(sourceChunkIds),
      tagsJson: JSON.stringify(tags),
      stableKey: input.draft.stableKey,
      contentHash,
      version,
      status: 'active',
      mergedIntoId: null,
      pinned: false,
      sortOrder: 0,
      metadataJson: JSON.stringify(metadata),
      createdAt: input.now,
      updatedAt: input.now,
    }).run()
  }
  else if (materialChanged) {
    version = existing.version + 1
    tx.update(chronicleKnowledgeCards).set({
      title: input.draft.title,
      content: input.draft.content,
      cardType: input.draft.cardType,
      dimension: input.draft.dimension,
      confidenceBps: input.draft.confidenceBps,
      sourceMemoryIdsJson: JSON.stringify(sourceMemoryIds),
      sourceSegmentIdsJson: JSON.stringify(sourceSegmentIds),
      sourceChunkIdsJson: JSON.stringify(sourceChunkIds),
      tagsJson: JSON.stringify(tags),
      contentHash,
      version,
      status: 'active',
      metadataJson: JSON.stringify(metadata),
      updatedAt: input.now,
    }).where(eq(chronicleKnowledgeCards.id, existing.id)).run()
  }
  else {
    knowledgeId = existing.id
    version = existing.version
    tx.update(chronicleKnowledgeCards).set({
      sourceMemoryIdsJson: JSON.stringify(sourceMemoryIds),
      sourceSegmentIdsJson: JSON.stringify(sourceSegmentIds),
      sourceChunkIdsJson: JSON.stringify(sourceChunkIds),
      tagsJson: JSON.stringify(tags),
      metadataJson: JSON.stringify(metadata),
      updatedAt: input.now,
    }).where(eq(chronicleKnowledgeCards.id, existing.id)).run()
  }

  const versionId = getOrCreateKnowledgeVersion(tx, {
    knowledgeId,
    version,
    title: input.draft.title,
    content: input.draft.content,
    cardType: input.draft.cardType,
    dimension: input.draft.dimension,
    confidenceBps: input.draft.confidenceBps,
    sourceMemoryIds,
    sourceSegmentIds,
    sourceChunkIds,
    tags,
    metadata: {
      evidenceHash: input.evidenceHash,
      pipelineRunId: input.runId,
      modelId: input.modelId,
      profileId: input.profileId,
      materialChanged,
    },
    now: input.now,
  })
  insertKnowledgeSources(tx, {
    knowledgeId,
    versionId,
    context: input.context,
    runId: input.runId,
    memoryIds: input.memoryIds,
    evidenceHash: input.evidenceHash,
    now: input.now,
  })

  return {
    card: tx.select().from(chronicleKnowledgeCards).where(eq(chronicleKnowledgeCards.id, knowledgeId)).get()!,
    versionId,
  }
}

function getOrCreateKnowledgeVersion(
  tx: ChronicleTx,
  input: {
    knowledgeId: string
    version: number
    title: string
    content: string
    cardType: KnowledgeCardType
    dimension: KnowledgeDimension
    confidenceBps: number
    sourceMemoryIds: string[]
    sourceSegmentIds: string[]
    sourceChunkIds: string[]
    tags: string[]
    metadata: Record<string, unknown>
    now: number
  },
): string {
  const existing = tx
    .select({ id: chronicleKnowledgeVersions.id })
    .from(chronicleKnowledgeVersions)
    .where(sql`${chronicleKnowledgeVersions.knowledgeId} = ${input.knowledgeId} AND ${chronicleKnowledgeVersions.version} = ${input.version}`)
    .get()
  if (existing) {
    return existing.id
  }
  const id = randomUUID()
  tx.insert(chronicleKnowledgeVersions).values({
    id,
    knowledgeId: input.knowledgeId,
    version: input.version,
    title: input.title,
    content: input.content,
    cardType: input.cardType,
    dimension: input.dimension,
    confidenceBps: input.confidenceBps,
    sourceMemoryIdsJson: JSON.stringify(input.sourceMemoryIds),
    sourceSegmentIdsJson: JSON.stringify(input.sourceSegmentIds),
    sourceChunkIdsJson: JSON.stringify(input.sourceChunkIds),
    tagsJson: JSON.stringify(input.tags),
    metadataJson: JSON.stringify(input.metadata),
    createdAt: input.now,
  }).run()
  return id
}

function insertKnowledgeSources(
  tx: ChronicleTx,
  input: {
    knowledgeId: string
    versionId: string
    context: ActivitySegmentContext
    runId: string
    memoryIds: string[]
    evidenceHash: string
    now: number
  },
): void {
  const sources = [
    { sourceKind: 'activity' as const, evidenceType: 'activity-segment', evidenceId: input.context.segment.id, memoryId: null as string | null },
    ...input.memoryIds.map(memoryId => ({ sourceKind: 'memory' as const, evidenceType: 'memory', evidenceId: memoryId, memoryId })),
  ]
  for (const source of sources) {
    const exists = tx
      .select({ id: chronicleKnowledgeSources.id })
      .from(chronicleKnowledgeSources)
      .where(sql`${chronicleKnowledgeSources.knowledgeId} = ${input.knowledgeId} AND ${chronicleKnowledgeSources.versionId} = ${input.versionId} AND ${chronicleKnowledgeSources.evidenceType} = ${source.evidenceType} AND ${chronicleKnowledgeSources.evidenceId} = ${source.evidenceId}`)
      .get()
    if (exists) {
      continue
    }
    tx.insert(chronicleKnowledgeSources).values({
      id: randomUUID(),
      knowledgeId: input.knowledgeId,
      versionId: input.versionId,
      segmentId: input.context.segment.id,
      memoryId: source.memoryId,
      memoryChunkId: null,
      pipelineRunId: input.runId,
      sourceKind: source.sourceKind,
      evidenceType: source.evidenceType,
      evidenceId: source.evidenceId,
      metadataJson: JSON.stringify({ evidenceHash: input.evidenceHash }),
      createdAt: input.now,
      updatedAt: input.now,
    }).run()
  }
}

function buildDreamMergeCandidates(
  cards: Array<typeof chronicleKnowledgeCards.$inferSelect>,
  threshold: number,
): DreamMergeCandidateDraft[] {
  const candidates: DreamMergeCandidateDraft[] = []
  const used = new Set<string>()
  for (const card of cards) {
    if (used.has(card.id)) {
      continue
    }
    const cardEmbedding = buildTextEmbeddingVector(`${card.title}\n${card.content}`)
    const matches = cards
      .filter(candidate => candidate.id !== card.id
        && !used.has(candidate.id)
        && candidate.workspaceId === card.workspaceId
        && candidate.dimension === card.dimension
        && candidate.status === 'active')
      .map((candidate) => {
        const candidateEmbedding = buildTextEmbeddingVector(`${candidate.title}\n${candidate.content}`)
        const score = cardEmbedding.modelId === candidateEmbedding.modelId && cardEmbedding.modelVersion === candidateEmbedding.modelVersion
          ? cosineSimilarity(cardEmbedding.vector, candidateEmbedding.vector)
          : 0
        return { card: candidate, score }
      })
      .filter(match => match.score >= threshold)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
    if (matches.length === 0) {
      continue
    }
    const group = [card, ...matches.map(match => match.card)]
    for (const item of group) {
      used.add(item.id)
    }
    const bestScore = matches[0]?.score ?? threshold
    candidates.push({
      workspaceId: card.workspaceId,
      sourceKnowledgeIds: group.map(item => item.id),
      proposedTitle: chooseDreamMergedTitle(group),
      proposedContent: group.map(item => item.content.trim()).filter(Boolean).join('\n\n'),
      proposedCardType: chooseDreamMergedCardType(group),
      proposedDimension: card.dimension,
      score: bestScore,
      reason: `Semantic similarity ${bestScore.toFixed(3)} using ${cardEmbedding.modelId}/${cardEmbedding.modelVersion}`,
      vectorMode: `${cardEmbedding.modelId}/${cardEmbedding.modelVersion}`,
    })
  }
  return candidates
}

function applyDreamMergeCandidate(
  tx: ChronicleTx,
  candidate: DreamMergeCandidateDraft,
  runId: string,
  now: number,
): string {
  const sourceCards = tx
    .select()
    .from(chronicleKnowledgeCards)
    .where(inArray(chronicleKnowledgeCards.id, candidate.sourceKnowledgeIds))
    .all()
  const sourceMemoryIds = uniqueStrings(sourceCards.flatMap(card => StringListTextSchema.parse(card.sourceMemoryIdsJson)))
  const sourceSegmentIds = uniqueStrings(sourceCards.flatMap(card => StringListTextSchema.parse(card.sourceSegmentIdsJson)))
  const sourceChunkIds = uniqueStrings(sourceCards.flatMap(card => StringListTextSchema.parse(card.sourceChunkIdsJson)))
  const tags = uniqueStrings(sourceCards.flatMap(card => StringListTextSchema.parse(card.tagsJson))).slice(0, 24)
  const stableKey = `dream-merge:${hashText(candidate.sourceKnowledgeIds.slice().sort().join('|')).slice(0, 32)}`
  const contentHash = hashText(canonicalizeMemoryContent(`${candidate.proposedTitle}\n${candidate.proposedContent}`))
  const outputId = randomUUID()

  tx.insert(chronicleKnowledgeCards).values({
    id: outputId,
    workspaceId: candidate.workspaceId,
    title: candidate.proposedTitle,
    content: candidate.proposedContent,
    cardType: candidate.proposedCardType,
    dimension: candidate.proposedDimension,
    confidenceBps: Math.max(1, RatioBpsSchema.parse(candidate.score)),
    sourceMemoryIdsJson: JSON.stringify(sourceMemoryIds),
    sourceSegmentIdsJson: JSON.stringify(sourceSegmentIds),
    sourceChunkIdsJson: JSON.stringify(sourceChunkIds),
    tagsJson: JSON.stringify(tags),
    stableKey,
    contentHash,
    version: 1,
    status: 'active',
    mergedIntoId: null,
    pinned: false,
    sortOrder: 0,
    metadataJson: JSON.stringify({
      source: 'dream-merge',
      runId,
      mergedFromIds: candidate.sourceKnowledgeIds,
      vectorMode: candidate.vectorMode,
    }),
    createdAt: now,
    updatedAt: now,
  }).run()

  tx.insert(chronicleKnowledgeVersions).values({
    id: randomUUID(),
    knowledgeId: outputId,
    version: 1,
    title: candidate.proposedTitle,
    content: candidate.proposedContent,
    cardType: candidate.proposedCardType,
    dimension: candidate.proposedDimension,
    confidenceBps: Math.max(1, RatioBpsSchema.parse(candidate.score)),
    sourceMemoryIdsJson: JSON.stringify(sourceMemoryIds),
    sourceSegmentIdsJson: JSON.stringify(sourceSegmentIds),
    sourceChunkIdsJson: JSON.stringify(sourceChunkIds),
    tagsJson: JSON.stringify(tags),
    metadataJson: JSON.stringify({
      source: 'dream-merge',
      runId,
      mergedFromIds: candidate.sourceKnowledgeIds,
    }),
    createdAt: now,
  }).run()

  for (const source of sourceCards) {
    tx.update(chronicleKnowledgeCards).set({
      version: source.version + 1,
      status: 'merged',
      mergedIntoId: outputId,
      updatedAt: now,
      metadataJson: JSON.stringify({
        ...JsonRecordTextSchema.parse(source.metadataJson),
        mergedByRunId: runId,
        mergedIntoId: outputId,
      }),
    }).where(eq(chronicleKnowledgeCards.id, source.id)).run()
    tx.insert(chronicleKnowledgeVersions).values({
      id: randomUUID(),
      knowledgeId: source.id,
      version: source.version + 1,
      title: source.title,
      content: source.content,
      cardType: source.cardType,
      dimension: source.dimension,
      confidenceBps: source.confidenceBps,
      sourceMemoryIdsJson: source.sourceMemoryIdsJson,
      sourceSegmentIdsJson: source.sourceSegmentIdsJson,
      sourceChunkIdsJson: source.sourceChunkIdsJson,
      tagsJson: source.tagsJson,
      metadataJson: JSON.stringify({
        source: 'dream-merge-mark-merged',
        runId,
        mergedIntoId: outputId,
      }),
      createdAt: now,
    }).run()
  }

  return outputId
}

function chooseDreamMergedTitle(cards: Array<typeof chronicleKnowledgeCards.$inferSelect>): string {
  return cards
    .slice()
    .sort((left, right) => right.confidenceBps - left.confidenceBps || left.title.length - right.title.length)[0]
    ?.title ?? 'Merged knowledge'
}

function chooseDreamMergedCardType(cards: Array<typeof chronicleKnowledgeCards.$inferSelect>): KnowledgeCardType {
  const priority: KnowledgeCardType[] = ['decision', 'task', 'insight', 'pattern', 'fact']
  return priority.find(type => cards.some(card => card.cardType === type)) ?? 'fact'
}

interface ActivityAssignmentInput {
  trigger: ActivityPipelineTrigger
  workspaceId: string | null
  occurredAt: number
  segmentType: ActivitySegmentType
  frontApp: string | null
  title: string | null
  summary: string | null
  refs: z.infer<typeof ActivitySourceRefsSchema>
  metadata: Record<string, unknown>
}

function assignActivityEvidence(rawInput: z.input<typeof ActivityAssignmentInputSchema>): { sessionId: string, segmentId: string } {
  const input = ActivityAssignmentInputSchema.parse(rawInput)
  const now = currentUnixSeconds()
  return db().transaction((tx) => {
    const session = findActivitySession(tx, input.workspaceId, input.occurredAt, now, input)
    const candidate = findActivitySegmentCandidate(tx, session.id, input)
    const shouldAppend = !!candidate
    const segmentId = shouldAppend && candidate ? candidate.id : randomUUID()
    const sourceRefs = mergeActivitySourceRefs(candidate?.sourceRefsJson, input.refs)
    const sourceCounts = countActivitySourceRefs(sourceRefs)
    const metadata = {
      ...(candidate ? JsonRecordTextSchema.parse(candidate.metadataJson) : {}),
      ...input.metadata,
    }
    const startedAt = candidate && shouldAppend ? Math.min(candidate.startedAt, input.occurredAt) : input.occurredAt
    const endedAt = candidate && shouldAppend ? Math.max(candidate.endedAt, input.occurredAt) : input.occurredAt
    const startSnapshotId = candidate?.startSnapshotId ?? firstSourceRef(sourceRefs.snapshotIds) ?? null
    const endSnapshotId = lastSourceRef(sourceRefs.snapshotIds) ?? candidate?.endSnapshotId ?? null

    if (candidate && shouldAppend) {
      tx.update(chronicleActivitySegments).set({
        startSnapshotId,
        endSnapshotId,
        startedAt,
        endedAt,
        segmentType: chooseActivitySegmentType(candidate.segmentType, input.segmentType),
        frontApp: input.frontApp ?? candidate.frontApp,
        title: input.title ?? candidate.title,
        summary: input.summary ?? candidate.summary,
        sourceCountsJson: JSON.stringify(sourceCounts),
        sourceRefsJson: JSON.stringify(sourceRefs),
        metadataJson: JSON.stringify(metadata),
        updatedAt: now,
      }).where(eq(chronicleActivitySegments.id, candidate.id)).run()
    }
    else {
      tx.insert(chronicleActivitySegments).values({
        id: segmentId,
        sessionId: session.id,
        workspaceId: input.workspaceId,
        startSnapshotId,
        endSnapshotId,
        startedAt: input.occurredAt,
        endedAt: input.occurredAt,
        segmentType: input.segmentType,
        frontApp: input.frontApp,
        title: input.title,
        summary: input.summary,
        sourceCountsJson: JSON.stringify(sourceCounts),
        sourceRefsJson: JSON.stringify(sourceRefs),
        metadataJson: JSON.stringify(metadata),
        pipelineStatus: 'collecting',
        isCrystallized: false,
        createdAt: now,
        updatedAt: now,
      }).run()
    }

    recordSegmentationRun(tx, input, session.id, segmentId, now)

    refreshActivitySession(tx, session.id, now)
    return { sessionId: session.id, segmentId }
  })
}

function recordSegmentationRun(
  tx: ChronicleTx,
  input: ActivityAssignmentInput,
  sessionId: string,
  segmentId: string,
  now: number,
): void {
  const sourceKey = buildPipelineSourceKey(input)
  const existing = tx
    .select({ id: chroniclePipelineRuns.id })
    .from(chroniclePipelineRuns)
    .where(eq(chroniclePipelineRuns.sourceKey, sourceKey))
    .get()
  const values = {
    sessionId,
    segmentId,
    workspaceId: input.workspaceId,
    trigger: input.trigger,
    sourceKey,
    stage: 'segmentation' as const,
    status: 'running' as const,
    startedAt: input.occurredAt,
    endedAt: null,
    errorMessage: null,
    snapshotIdsJson: JSON.stringify(input.refs.snapshotIds),
    messageIdsJson: JSON.stringify(input.refs.messageIds),
    audioTranscriptIdsJson: JSON.stringify(input.refs.audioTranscriptIds),
    audioRawSegmentIdsJson: JSON.stringify(input.refs.audioRawSegmentIds),
    memoryIdsJson: JSON.stringify(input.refs.memoryIds),
    segmentIdsJson: JSON.stringify([segmentId]),
    snapshotsCount: input.refs.snapshotIds.length,
    messagesCount: input.refs.messageIds.length,
    audioTranscriptsCount: input.refs.audioTranscriptIds.length,
    audioRawSegmentsCount: input.refs.audioRawSegmentIds.length,
    memoriesCount: input.refs.memoryIds.length,
    segmentsCount: 1,
    triageResultsJson: '{}',
    summaryResultsJson: '{}',
    metadataJson: JSON.stringify({
      ...input.metadata,
      pendingStages: ['triage', 'summarization', 'crystallization'],
    }),
    updatedAt: now,
  }

  if (existing) {
    tx.update(chroniclePipelineRuns).set(values).where(eq(chroniclePipelineRuns.id, existing.id)).run()
    return
  }

  tx.insert(chroniclePipelineRuns).values({
    id: randomUUID(),
    ...values,
    createdAt: now,
  }).run()
}

function buildPipelineSourceKey(input: ActivityAssignmentInput): string {
  const refs = ActivitySourceRefsSchema.parse(input.refs)
  const parts = [
    ...refs.snapshotIds.map(id => `snapshot:${id}`),
    ...refs.messageIds.map(id => `message:${id}`),
    ...refs.audioTranscriptIds.map(id => `audio-transcript:${id}`),
    ...refs.audioRawSegmentIds.map(id => `audio-raw:${id}`),
    ...refs.memoryIds.map(id => `memory:${id}`),
    ...refs.accessibilitySnapshotIds.map(id => `accessibility:${id}`),
  ].sort()
  return `${input.trigger}:${parts.join('|') || `${input.workspaceId ?? 'global'}:${input.occurredAt}`}`
}

function findActivitySession(
  tx: ChronicleTx,
  workspaceId: string | null,
  occurredAt: number,
  now: number,
  input: ActivityAssignmentInput,
): typeof chronicleActivitySessions.$inferSelect {
  const existing = tx
    .select()
    .from(chronicleActivitySessions)
    .where(workspaceId === null
      ? sql`${chronicleActivitySessions.workspaceId} IS NULL`
      : eq(chronicleActivitySessions.workspaceId, workspaceId))
    .all()
    .find(session => occurredAt >= session.startedAt - ACTIVITY_SESSION_GAP_SECONDS
      && occurredAt <= (session.endedAt ?? session.startedAt) + ACTIVITY_SESSION_GAP_SECONDS)

  if (existing) {
    return existing
  }

  const id = randomUUID()
  tx.insert(chronicleActivitySessions).values({
    id,
    workspaceId,
    startedAt: occurredAt,
    endedAt: occurredAt,
    frontApp: input.frontApp,
    title: input.title,
    segmentCount: 0,
    snapshotCount: 0,
    messageCount: 0,
    audioTranscriptCount: 0,
    audioRawSegmentCount: 0,
    accessibilitySnapshotCount: 0,
    durationSeconds: 0,
    isMeeting: input.segmentType === 'meeting',
    meetingTitle: input.segmentType === 'meeting' ? input.title : null,
    metadataJson: JSON.stringify({ createdFrom: input.trigger }),
    createdAt: now,
    updatedAt: now,
  }).run()
  return tx.select().from(chronicleActivitySessions).where(eq(chronicleActivitySessions.id, id)).get()!
}

function findActivitySegmentCandidate(
  tx: ChronicleTx,
  sessionId: string,
  input: ActivityAssignmentInput,
): typeof chronicleActivitySegments.$inferSelect | undefined {
  return tx
    .select()
    .from(chronicleActivitySegments)
    .where(input.workspaceId === null
      ? sql`${chronicleActivitySegments.sessionId} = ${sessionId} AND ${chronicleActivitySegments.workspaceId} IS NULL`
      : sql`${chronicleActivitySegments.sessionId} = ${sessionId} AND ${chronicleActivitySegments.workspaceId} = ${input.workspaceId}`)
    .orderBy(desc(chronicleActivitySegments.startedAt))
    .all()
    .find(segment => canAppendActivitySegment(segment, input))
}

function canAppendActivitySegment(
  candidate: typeof chronicleActivitySegments.$inferSelect,
  input: ActivityAssignmentInput,
): boolean {
  if (input.occurredAt < candidate.startedAt || input.occurredAt < candidate.endedAt) {
    return false
  }
  const gapSeconds = input.occurredAt - candidate.endedAt
  if (gapSeconds > ACTIVITY_IDLE_BOUNDARY_SECONDS) {
    return false
  }
  if (input.occurredAt - candidate.startedAt > ACTIVITY_MAX_SEGMENT_SECONDS) {
    return false
  }
  return normalizeActivityBoundary(candidate.frontApp) === normalizeActivityBoundary(input.frontApp)
    && normalizeActivityBoundary(candidate.title) === normalizeActivityBoundary(input.title)
}

function chooseActivitySegmentType(current: ActivitySegmentType, next: ActivitySegmentType): ActivitySegmentType {
  if (current === next) {
    return current
  }
  if (current === 'unknown') {
    return next
  }
  if (next === 'unknown') {
    return current
  }
  if (current === 'meeting' || next === 'meeting') {
    return 'meeting'
  }
  if (current === 'chat' || next === 'chat') {
    return 'chat'
  }
  if (current === 'audio' || next === 'audio') {
    return 'audio'
  }
  return 'work'
}

function refreshActivitySession(tx: ChronicleTx, sessionId: string, now: number): void {
  const segments = tx.select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.sessionId, sessionId)).all()
  if (segments.length === 0) {
    return
  }

  const startedAt = Math.min(...segments.map(segment => segment.startedAt))
  const endedAt = Math.max(...segments.map(segment => segment.endedAt))
  const counts = segments.reduce((accumulator, segment) => {
    const sourceCounts = ActivitySourceCountsJsonSchema.parse(segment.sourceCountsJson)
    accumulator.snapshotCount += Math.floor(sourceCounts.snapshotIds)
    accumulator.messageCount += Math.floor(sourceCounts.messageIds)
    accumulator.audioTranscriptCount += Math.floor(sourceCounts.audioTranscriptIds)
    accumulator.audioRawSegmentCount += Math.floor(sourceCounts.audioRawSegmentIds)
    accumulator.accessibilitySnapshotCount += Math.floor(sourceCounts.accessibilitySnapshotIds)
    return accumulator
  }, {
    snapshotCount: 0,
    messageCount: 0,
    audioTranscriptCount: 0,
    audioRawSegmentCount: 0,
    accessibilitySnapshotCount: 0,
  })
  const first = segments.reduce((left, right) => left.startedAt <= right.startedAt ? left : right)
  const hasMeeting = segments.some(segment => segment.segmentType === 'meeting')

  tx.update(chronicleActivitySessions).set({
    startedAt,
    endedAt,
    frontApp: first.frontApp,
    title: first.title,
    segmentCount: segments.length,
    snapshotCount: counts.snapshotCount,
    messageCount: counts.messageCount,
    audioTranscriptCount: counts.audioTranscriptCount,
    audioRawSegmentCount: counts.audioRawSegmentCount,
    accessibilitySnapshotCount: counts.accessibilitySnapshotCount,
    durationSeconds: Math.max(0, endedAt - startedAt),
    isMeeting: hasMeeting,
    meetingTitle: hasMeeting ? segments.find(segment => segment.segmentType === 'meeting')?.title ?? null : null,
    updatedAt: now,
  }).where(eq(chronicleActivitySessions.id, sessionId)).run()
}

function mergeActivitySourceRefs(
  currentJson: string | undefined,
  next: ActivityAssignmentInput['refs'],
): Record<string, string[]> {
  const current = currentJson
    ? ActivitySourceRefsJsonSchema.parse(currentJson)
    : ActivitySourceRefsSchema.parse({})
  const nextRefs = ActivitySourceRefsSchema.parse(next)
  const merged: Record<string, string[]> = {}
  for (const key of ['snapshotIds', 'messageIds', 'audioTranscriptIds', 'audioRawSegmentIds', 'memoryIds', 'accessibilitySnapshotIds']) {
    merged[key] = uniqueStrings([
      ...current[key],
      ...nextRefs[key],
    ])
  }
  return merged
}

function countActivitySourceRefs(sourceRefs: Record<string, string[]>): Record<string, number> {
  return Object.fromEntries(Object.entries(sourceRefs).map(([key, values]) => [key, values.length]))
}

function firstSourceRef(values: string[] | undefined): string | null {
  return values && values.length > 0 ? values[0] : null
}

function lastSourceRef(values: string[] | undefined): string | null {
  return values && values.length > 0 ? values.at(-1) ?? null : null
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(value => value.length > 0))]
}

interface SpeakerProfileUpsertInput {
  workspaceId: string | null
  displayName: string
  aliases?: string[]
  embedding?: number[] | null
  embeddingModelId?: string | null
  sampleCount?: number
  seenAt?: number | null
  transcriptId?: string | null
  segmentId?: string | null
  metadata?: Record<string, unknown>
  now?: number
}

function upsertSpeakerProfileFromLabel(
  d: ChronicleDb | ChronicleTx,
  rawInput: SpeakerProfileUpsertInput,
): typeof chronicleSpeakerProfiles.$inferSelect {
  const input = SpeakerProfileUpsertInputSchema.parse(rawInput)
  const now = input.now
  const displayName = input.displayName
  const normalizedLabel = normalizeSpeakerDisplayName(displayName).toLocaleLowerCase()
  const workspaceId = input.workspaceId || null
  const stableKey = buildSpeakerStableKey(workspaceId, normalizedLabel)
  const existing = d
    .select()
    .from(chronicleSpeakerProfiles)
    .where(eq(chronicleSpeakerProfiles.stableKey, stableKey))
    .get()
  const nextAliases = normalizeSpeakerAliases([
    ...(existing ? StringListTextSchema.parse(existing.aliasesJson) : []),
    ...input.aliases,
    displayName,
  ])
  const sampleDelta = input.sampleCount
  const nextSampleCount = Math.max(0, (existing?.sampleCount ?? 0) + sampleDelta)
  const existingMetadata = existing ? JsonRecordTextSchema.parse(existing.metadataJson) : {}
  const metadata = {
    ...existingMetadata,
    ...input.metadata,
  }
  const embeddingJson = input.embedding === undefined
    ? existing?.embeddingJson ?? null
    : input.embedding === null
      ? null
      : JSON.stringify(input.embedding)
  const embeddingDimensions = input.embedding === undefined
    ? existing?.embeddingDimensions ?? null
    : input.embedding === null
      ? null
      : input.embedding.length
  const embeddingModelId = input.embedding === undefined
    ? existing?.embeddingModelId ?? null
    : input.embedding === null
      ? null
      : input.embeddingModelId ?? existing?.embeddingModelId ?? 'speaker-embedding-extractor'
  const lastSeenAt = input.seenAt ?? (existing ? existing.lastSeenAt : null)

  if (existing) {
    d.update(chronicleSpeakerProfiles).set({
      displayName,
      normalizedLabel,
      aliasesJson: JSON.stringify(nextAliases),
      embeddingJson,
      embeddingDimensions,
      embeddingModelId,
      sampleCount: nextSampleCount,
      lastSeenAt,
      sourceTranscriptId: input.transcriptId === null ? existing.sourceTranscriptId : input.transcriptId,
      sourceSegmentId: input.segmentId === null ? existing.sourceSegmentId : input.segmentId,
      metadataJson: JSON.stringify(metadata),
      updatedAt: now,
    }).where(eq(chronicleSpeakerProfiles.id, existing.id)).run()
    return d.select().from(chronicleSpeakerProfiles).where(eq(chronicleSpeakerProfiles.id, existing.id)).get()!
  }

  const id = randomUUID()
  d.insert(chronicleSpeakerProfiles).values({
    id,
    workspaceId,
    stableKey,
    displayName,
    normalizedLabel,
    aliasesJson: JSON.stringify(nextAliases),
    embeddingJson,
    embeddingDimensions,
    embeddingModelId,
    sampleCount: nextSampleCount,
    lastSeenAt,
    sourceTranscriptId: input.transcriptId,
    sourceSegmentId: input.segmentId,
    metadataJson: JSON.stringify(metadata),
    createdAt: now,
    updatedAt: now,
  }).run()
  return d.select().from(chronicleSpeakerProfiles).where(eq(chronicleSpeakerProfiles.id, id)).get()!
}

function normalizeSpeakerDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) {
    throw new AppError({
      code: 'chronicle_speaker_profile_name_required',
      status: 400,
      message: 'Speaker displayName is required',
    })
  }
  return normalized
}

function normalizeSpeakerAliases(values: string[]): string[] {
  const aliases = values
    .map(value => value.trim().replace(/\s+/g, ' '))
    .filter(value => value.length > 0)
  return [...new Map(aliases.map(value => [value.toLocaleLowerCase(), value])).values()]
}

function buildSpeakerStableKey(workspaceId: string | null, normalizedLabel: string): string {
  return `${workspaceId ?? 'global'}:${normalizedLabel}`
}

function normalizeActivityBoundary(value: string | null): string {
  return (value ?? '').trim().toLowerCase()
}

export function recordAudioRawSegment(rawInput: AudioRawSegmentReportInput): AudioRawSegmentEntry {
  let input: z.infer<typeof AudioRawSegmentReportInputSchema>
  try {
    input = AudioRawSegmentReportInputSchema.parse(rawInput)
  }
  catch (error) {
    throw new AppError({
      code: 'invalid_chronicle_audio_raw_segment_input',
      status: 400,
      message: 'Invalid Chronicle input',
      details: { issues: error instanceof z.ZodError ? error.issues : [] },
    })
  }
  const config = syncConfig()
  const now = currentUnixSeconds()
  const recordedAt = input.recordedAt
  const existing = db()
    .select()
    .from(chronicleAudioRawSegments)
    .where(eq(chronicleAudioRawSegments.sourceId, input.sourceId))
    .get()
  const id = existing?.id ?? randomUUID()
  const metadata = {
    ...input.metadata,
    vadImplemented: input.vadImplemented,
    asrImplemented: input.asrImplemented,
    speakerLabelingImplemented: input.speakerLabelingImplemented,
  }
  const values = {
    sourceId: input.sourceId,
    workspaceId: config.workspaceId || null,
    recordedAt,
    source: input.source,
    status: input.status,
    audioPath: toRootRelative(config.storageRoot, input.audioPath),
    metadataPath: toRootRelative(config.storageRoot, input.metadataPath),
    sampleRate: input.sampleRate,
    channels: input.channels,
    sampleCount: input.sampleCount,
    droppedSamples: input.droppedSamples,
    durationMs: input.durationMs,
    rmsBps: input.rms,
    peakBps: input.peak,
    active: input.active,
    vadStatus: input.vadImplemented ? 'pending' as const : 'not-implemented' as const,
    asrStatus: input.asrImplemented ? 'pending' as const : 'not-implemented' as const,
    speakerStatus: input.speakerLabelingImplemented ? 'pending' as const : 'not-implemented' as const,
    metadataJson: JSON.stringify(metadata),
    updatedAt: now,
  }

  if (existing) {
    db().update(chronicleAudioRawSegments).set(values).where(eq(chronicleAudioRawSegments.id, id)).run()
  }
  else {
    db().insert(chronicleAudioRawSegments).values({
      id,
      ...values,
      createdAt: now,
    }).run()
  }

  recordEvent({
    type: 'audio',
    status: values.status === 'error' ? 'error' : 'success',
    message: 'Chronicle raw audio segment ingested',
    attrs: {
      sourceId: input.sourceId,
      rawSegmentId: id,
      active: input.active,
      durationMs: input.durationMs,
      audioPath: values.audioPath,
    },
  })
  if (!existing) {
    assignActivityEvidence({
      trigger: 'audio-raw',
      workspaceId: config.workspaceId || null,
      occurredAt: recordedAt,
      segmentType: 'audio',
      frontApp: input.source,
      title: input.active ? 'Audio activity' : 'Audio quiet segment',
      refs: { audioRawSegmentIds: [id] },
      metadata: {
        source: 'audio-raw-segment',
        rawSourceId: input.sourceId,
        active: input.active,
        status: values.status,
      },
    })
  }
  return toAudioRawSegmentEntry(db().select().from(chronicleAudioRawSegments).where(eq(chronicleAudioRawSegments.id, id)).get()!)
}

export function recordAudioRawSegmentProcessingResult(
  sourceId: string,
  rawInput: AudioRawSegmentProcessingResultInput,
): AudioRawSegmentEntry {
  const input = AudioRawSegmentProcessingResultInputSchema.parse(rawInput)
  const row = db()
    .select()
    .from(chronicleAudioRawSegments)
    .where(eq(chronicleAudioRawSegments.sourceId, sourceId))
    .get()
  if (!row) {
    throw new AppError({
      code: 'chronicle_audio_raw_segment_not_found',
      status: 404,
      message: 'Chronicle raw audio segment not found',
    })
  }
  const metadata = {
    ...JsonRecordTextSchema.parse(row.metadataJson),
    ...input.metadata,
    processingResult: {
      transcriptSourceId: input.transcriptSourceId,
      speakerProfileIds: input.speakerProfileIds,
      errorMessage: input.errorMessage,
      updatedAt: currentUnixSeconds(),
    },
  }
  const processingState = AudioRawSegmentProcessingStateSchema.parse({
    status: input.status === undefined ? deriveRawAudioStatus(input, row.status) : input.status,
    vadStatus: input.vadStatus === undefined ? row.vadStatus : input.vadStatus,
    asrStatus: input.asrStatus === undefined ? row.asrStatus : input.asrStatus,
    speakerStatus: input.speakerStatus === undefined ? row.speakerStatus : input.speakerStatus,
  })
  db().update(chronicleAudioRawSegments).set({
    status: processingState.status,
    vadStatus: processingState.vadStatus,
    asrStatus: processingState.asrStatus,
    speakerStatus: processingState.speakerStatus,
    metadataJson: JSON.stringify(metadata),
    updatedAt: currentUnixSeconds(),
  }).where(eq(chronicleAudioRawSegments.id, row.id)).run()
  recordEvent({
    type: 'audio',
    status: processingState.status === 'error' ? 'error' : 'success',
    message: 'Chronicle raw audio processing result recorded',
    attrs: {
      sourceId,
      rawSegmentId: row.id,
      status: processingState.status,
      vadStatus: processingState.vadStatus,
      asrStatus: processingState.asrStatus,
      speakerStatus: processingState.speakerStatus,
      transcriptSourceId: input.transcriptSourceId,
    },
  })
  return toAudioRawSegmentEntry(db().select().from(chronicleAudioRawSegments).where(eq(chronicleAudioRawSegments.id, row.id)).get()!)
}

function deriveRawAudioStatus(
  input: AudioRawSegmentProcessingResultInput,
  currentStatus: AudioRawSegmentEntry['status'],
): AudioRawSegmentEntry['status'] {
  if ([input.vadStatus, input.asrStatus, input.speakerStatus].includes('error')) {
    return 'error'
  }
  if ([input.vadStatus, input.asrStatus, input.speakerStatus].includes('pending')) {
    return 'queued'
  }
  if ([input.vadStatus, input.asrStatus, input.speakerStatus].includes('ready')) {
    return 'processed'
  }
  return currentStatus
}

export function recordAudioTranscript(rawInput: AudioTranscriptReportInput): AudioTranscriptEntry {
  let input: z.infer<typeof AudioTranscriptReportInputSchema>
  try {
    input = AudioTranscriptReportInputSchema.parse(rawInput)
  }
  catch (error) {
    throw new AppError({
      code: 'invalid_chronicle_audio_transcript_input',
      status: 400,
      message: 'Invalid Chronicle input',
      details: { issues: error instanceof z.ZodError ? error.issues : [] },
    })
  }
  const config = syncConfig()
  const now = currentUnixSeconds()
  const startedAt = input.startedAt
  const endedAt = input.endedAt
  const status = input.status
  const source = input.source
  const existing = db()
    .select()
    .from(chronicleAudioTranscripts)
    .where(eq(chronicleAudioTranscripts.sourceId, input.sourceId))
    .get()
  const transcriptId = existing?.id ?? randomUUID()
  const transcriptText = buildAudioTranscriptMemoryContent({
    title: input.title,
    startedAt,
    segments: input.segments,
  })
  const sourcePaths = [
    input.audioPath ? toRootRelative(config.storageRoot, input.audioPath) : null,
    input.transcriptPath ? toRootRelative(config.storageRoot, input.transcriptPath) : null,
  ].filter((path): path is string => !!path)

  db().transaction((tx) => {
    if (existing) {
      tx.update(chronicleAudioTranscripts).set({
        workspaceId: config.workspaceId || null,
        title: input.title,
        source,
        status,
        startedAt,
        endedAt,
        language: input.language,
        appBundleId: input.appBundleId,
        windowTitle: input.windowTitle,
        audioPath: input.audioPath ? toRootRelative(config.storageRoot, input.audioPath) : null,
        transcriptPath: input.transcriptPath ? toRootRelative(config.storageRoot, input.transcriptPath) : null,
        metadataJson: JSON.stringify(input.metadata),
        updatedAt: now,
      }).where(eq(chronicleAudioTranscripts.id, transcriptId)).run()
      tx.delete(chronicleAudioSegments).where(eq(chronicleAudioSegments.transcriptId, transcriptId)).run()
    }
    else {
      tx.insert(chronicleAudioTranscripts).values({
        id: transcriptId,
        sourceId: input.sourceId,
        workspaceId: config.workspaceId || null,
        memoryId: null,
        title: input.title,
        source,
        status,
        startedAt,
        endedAt,
        language: input.language,
        appBundleId: input.appBundleId,
        windowTitle: input.windowTitle,
        audioPath: input.audioPath ? toRootRelative(config.storageRoot, input.audioPath) : null,
        transcriptPath: input.transcriptPath ? toRootRelative(config.storageRoot, input.transcriptPath) : null,
        metadataJson: JSON.stringify(input.metadata),
        createdAt: now,
        updatedAt: now,
      }).run()
    }

    for (const [segmentIndex, segment] of input.segments.entries()) {
      const segmentId = randomUUID()
      const speakerLabel = segment.speakerLabel
      tx.insert(chronicleAudioSegments).values({
        id: segmentId,
        transcriptId,
        segmentIndex,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerLabel,
        text: segment.text,
        confidenceBps: segment.confidenceBps,
        language: segment.language ?? input.language,
        metadataJson: JSON.stringify(segment.metadata),
        createdAt: now,
        updatedAt: now,
      }).run()
      if (speakerLabel) {
        upsertSpeakerProfileFromLabel(tx, {
          workspaceId: config.workspaceId || null,
          displayName: speakerLabel,
          seenAt: startedAt + Math.floor(segment.startMs / 1000),
          transcriptId,
          segmentId,
          metadata: {
            source: 'audio-transcript',
            transcriptSourceId: input.sourceId,
            transcriptTitle: input.title,
          },
        })
      }
    }
  })

  const memory = recordMemory({
    sourceId: `audio-transcript:${input.sourceId}`,
    windowType: '10min',
    createdAt: new Date(startedAt * 1000).toISOString(),
    content: transcriptText,
    summaryKind: 'imported',
    sourceFramePaths: sourcePaths,
    metadata: {
      source: 'audio-transcript',
      transcriptId,
      transcriptSourceId: input.sourceId,
      title: input.title,
      transcriptStatus: status,
      language: input.language,
      segmentCount: input.segments.length,
      ...input.metadata,
    },
  }, { skipActivityAssignment: true })

  db().update(chronicleAudioTranscripts).set({
    memoryId: memory.id,
    updatedAt: now,
  }).where(eq(chronicleAudioTranscripts.id, transcriptId)).run()

  recordEvent({
    type: 'audio',
    status: status === 'error' ? 'error' : 'success',
    message: 'Chronicle audio transcript ingested',
    memoryId: memory.id,
    attrs: { sourceId: input.sourceId, transcriptId, segmentCount: input.segments.length, status },
  })
  if (!existing) {
    assignActivityEvidence({
      trigger: 'audio-transcript',
      workspaceId: config.workspaceId || null,
      occurredAt: startedAt,
      segmentType: 'meeting',
      frontApp: input.activityFrontApp,
      title: input.activityTitle,
      summary: transcriptText.slice(0, 500),
      refs: { audioTranscriptIds: [transcriptId], memoryIds: [memory.id] },
      metadata: {
        source: 'audio-transcript',
        transcriptSourceId: input.sourceId,
        transcriptStatus: status,
        segmentCount: input.segments.length,
      },
    })
  }
  return toAudioTranscriptEntry(db().select().from(chronicleAudioTranscripts).where(eq(chronicleAudioTranscripts.id, transcriptId)).get()!)
}

export function listSpeakerProfiles(): SpeakerProfileEntry[] {
  const config = syncConfig()
  const workspaceId = config.workspaceId || null
  const rows = workspaceId
    ? db()
        .select()
        .from(chronicleSpeakerProfiles)
        .where(eq(chronicleSpeakerProfiles.workspaceId, workspaceId))
        .orderBy(desc(chronicleSpeakerProfiles.lastSeenAt), chronicleSpeakerProfiles.displayName)
        .all()
    : db()
        .select()
        .from(chronicleSpeakerProfiles)
        .orderBy(desc(chronicleSpeakerProfiles.lastSeenAt), chronicleSpeakerProfiles.displayName)
        .all()
  return rows.map(toSpeakerProfileEntry)
}

export function upsertSpeakerProfile(rawInput: SpeakerProfileInput): SpeakerProfileEntry {
  const input = SpeakerProfileInputSchema.parse(rawInput)
  const config = syncConfig()
  const now = currentUnixSeconds()
  const displayName = input.displayName
  const aliases = input.aliases
  const embedding = input.embedding
  const lastSeenAt = input.lastSeenAt
  const sampleCount = input.sampleCount
  const row = upsertSpeakerProfileFromLabel(db(), {
    workspaceId: config.workspaceId || null,
    displayName,
    aliases,
    embedding,
    embeddingModelId: input.embeddingModelId,
    sampleCount,
    seenAt: lastSeenAt,
    metadata: {
      source: 'manual',
      ...input.metadata,
    },
    now,
  })
  return toSpeakerProfileEntry(row)
}

export async function syncSlackSource(
  sourceId: string,
  trigger: SlackSyncTrigger = 'manual',
): Promise<{ sourceId: string, status: 'success' | 'error', ingested: number, message: string }> {
  if (activeSlackSyncs.has(sourceId)) {
    return { sourceId, status: 'success', ingested: 0, message: 'Slack sync already running' }
  }

  activeSlackSyncs.add(sourceId)
  try {
    return await syncSlackSourceNow(sourceId, trigger)
  }
  finally {
    activeSlackSyncs.delete(sourceId)
  }
}

export async function handleSlackEvents(
  sourceId: string,
  input: SlackEventsInput,
): Promise<SlackEventsResult> {
  const source = db().select().from(chronicleMessageSources).where(eq(chronicleMessageSources.id, sourceId)).get()
  if (!source) {
    throw new AppError({ code: 'chronicle_message_source_not_found', status: 404, message: 'Chronicle message source not found' })
  }
  if (source.platform !== 'slack') {
    throw new AppError({ code: 'chronicle_message_source_unsupported', status: 400, message: 'Only Slack message sources can receive Slack events' })
  }

  const sourceConfig = SlackSourceConfigJsonSchema.parse(source.configJson)
  if (sourceConfig.realtimeMode !== 'events-api') {
    throw new AppError({
      code: 'chronicle_slack_events_disabled',
      status: 400,
      message: 'Slack Events API is not enabled for this Chronicle source',
    })
  }
  if (!sourceConfig.signingSecretRef) {
    throw new AppError({
      code: 'chronicle_slack_signing_secret_missing',
      status: 400,
      message: 'Slack signing secret is not configured',
    })
  }

  const signingSecret = readSecret(sourceConfig.signingSecretRef)
  verifySlackSignature({
    rawBody: input.rawBody,
    signature: input.signature,
    timestamp: input.timestamp,
    signingSecret,
  })

  const payload = SlackEventsPayloadJsonSchema.parse(input.rawBody)
  if (payload.type === 'url_verification') {
    const challengePayload = SlackUrlVerificationPayloadSchema.parse(payload)
    return {
      sourceId: source.id,
      status: 'ok',
      ingested: 0,
      message: 'Slack URL verification accepted',
      challenge: challengePayload.challenge,
    }
  }

  if (!source.enabled) {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Chronicle message source is disabled' }
  }
  if (payload.type !== 'event_callback') {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Slack event type ignored' }
  }

  const eventPayload = SlackEventCallbackPayloadParseSchema.parse(payload)
  const event = eventPayload.event
  const eventType = event.type
  if (eventType !== 'message' && eventType !== 'app_mention') {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Slack event subtype ignored' }
  }
  const subtype = event.subtype
  if (subtype && subtype !== 'bot_message') {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Slack message subtype ignored' }
  }

  const channelId = event.channel
  const messageTs = event.ts
  const text = event.text
  const channelIds = StringListTextSchema.parse(source.channelIdsJson)
  if (!channelIds.includes(channelId)) {
    return { sourceId: source.id, status: 'ignored', ingested: 0, message: 'Slack channel is outside Chronicle allowlist' }
  }

  const teamId = eventPayload.team_id ?? source.teamId
  const inserted = recordSlackMessage({
    sourceId: source.id,
    workspaceId: source.workspaceId,
    teamId,
    channelId,
    channelName: event.channel_name,
    userId: event.userId,
    userName: event.username,
    text,
    messageTs,
    threadId: event.threadId,
    permalink: null,
    raw: eventPayload,
  })
  const now = currentUnixSeconds()
  const messageAt = slackTsToUnix(messageTs)
  db().update(chronicleMessageSources).set({
    teamId,
    status: 'ready',
    lastMessageAt: Math.max(source.lastMessageAt ?? 0, messageAt),
    lastError: null,
    updatedAt: now,
  }).where(eq(chronicleMessageSources.id, source.id)).run()
  recordEvent({
    type: 'message',
    status: 'success',
    message: inserted ? 'Chronicle Slack event ingested' : 'Chronicle Slack event deduplicated',
    attrs: { sourceId: source.id, channelId, messageTs, inserted },
  })

  return {
    sourceId: source.id,
    status: 'ok',
    ingested: inserted ? 1 : 0,
    message: inserted ? 'Slack event ingested' : 'Slack event already ingested',
  }
}

async function syncSlackSourceNow(
  sourceId: string,
  trigger: SlackSyncTrigger,
): Promise<{ sourceId: string, status: 'success' | 'error', ingested: number, message: string }> {
  const source = db().select().from(chronicleMessageSources).where(eq(chronicleMessageSources.id, sourceId)).get()
  if (!source) {
    throw new AppError({ code: 'chronicle_message_source_not_found', status: 404, message: 'Chronicle message source not found' })
  }
  if (source.platform !== 'slack') {
    throw new AppError({ code: 'chronicle_message_source_unsupported', status: 400, message: 'Only Slack message sources can be synced' })
  }
  if (!source.enabled) {
    throw new AppError({ code: 'chronicle_message_source_disabled', status: 400, message: 'Chronicle message source is disabled' })
  }
  if (!source.botTokenRef) {
    if (trigger === 'background') {
      return failSlackSync(source.id, 'Slack bot token secret is not configured')
    }
    throw new AppError({ code: 'chronicle_slack_token_missing', status: 400, message: 'Slack bot token secret is not configured' })
  }
  const channelIds = StringListTextSchema.parse(source.channelIdsJson).filter(channelId => channelId.trim().length > 0)
  if (channelIds.length === 0) {
    if (trigger === 'background') {
      return failSlackSync(source.id, 'At least one Slack channel id is required')
    }
    throw new AppError({ code: 'chronicle_slack_channels_missing', status: 400, message: 'At least one Slack channel id is required' })
  }

  updateMessageSourceStatus(source.id, 'syncing', null)
  try {
    const token = readSecret(source.botTokenRef)
    let ingested = 0
    let lastMessageAt = source.lastMessageAt
    const channelNames = await fetchSlackChannelNames(token, channelIds)
    for (const channelId of channelIds) {
      const messages = await fetchSlackHistory(token, channelId, source.lastSyncAt)
      for (const message of messages) {
        const parsedMessage = SlackHistoryMessageSchema.parse(message)
        const text = parsedMessage.text
        const messageTs = parsedMessage.ts
        const messageAt = slackTsToUnix(messageTs)
        const inserted = recordSlackMessage({
          sourceId: source.id,
          workspaceId: source.workspaceId,
          teamId: source.teamId,
          channelId,
          channelName: parsedMessage.channel_name ?? channelNames.get(channelId) ?? null,
          userId: parsedMessage.userId,
          userName: parsedMessage.username,
          text,
          messageTs,
          threadId: parsedMessage.threadId,
          permalink: null,
          raw: parsedMessage,
        })
        if (inserted) {
          ingested += 1
        }
        lastMessageAt = Math.max(lastMessageAt ?? 0, messageAt)
      }
    }
    const now = currentUnixSeconds()
    db().update(chronicleMessageSources).set({
      status: 'ready',
      lastSyncAt: now,
      lastMessageAt,
      lastError: null,
      updatedAt: now,
    }).where(eq(chronicleMessageSources.id, source.id)).run()
    recordEvent({
      type: 'message',
      status: 'success',
      message: 'Chronicle Slack sync completed',
      attrs: { sourceId: source.id, ingested, trigger },
    })
    return { sourceId: source.id, status: 'success', ingested, message: 'Slack sync completed' }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failSlackSync(source.id, message, trigger)
  }
}

export function recordSnapshot(rawInput: ChronicleSnapshotReportInput): typeof chronicleSnapshots.$inferSelect | ChronicleSnapshotIgnoredResponse {
  const input = ChronicleSnapshotReportInputSchema.parse(rawInput)
  const config = syncConfig()
  const now = currentUnixSeconds()
  const capturedAt = input.capturedAt
  const existing = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.sourceId, input.sourceId)).get()
  const closedEyesDecision = getClosedEyesSnapshotDecision(config, input)
  if (!existing && closedEyesDecision.discard) {
    const closedEyesBreadcrumbAttrs = input.closedEyes === undefined
      ? {
          closedEyesStatus: 'unknown',
          detector: null,
          confidenceBps: null,
        }
      : {
          closedEyesStatus: input.closedEyes.status,
          detector: input.closedEyes.detector,
          confidenceBps: input.closedEyes.confidenceBps,
        }
    recordPrivacyBreadcrumb({
      kind: 'closed-eyes-discard',
      status: 'success',
      message: 'Chronicle discarded snapshot because the user was absent or eyes were closed',
      attrs: {
        sourceId: input.sourceId,
        displayId: input.displayId,
        frameIndex: input.frameIndex,
        framePath: toRootRelative(config.storageRoot, input.framePath),
        ...closedEyesBreadcrumbAttrs,
        closedEyesMode: config.closedEyesMode,
        reason: closedEyesDecision.reason,
      },
    })
    return {
      status: 'ignored',
      reason: closedEyesDecision.reason,
      sourceId: input.sourceId,
      capturedAt: new Date(capturedAt * 1000).toISOString(),
      capturedAtUnix: capturedAt,
    }
  }
  const id = existing?.id ?? randomUUID()
  const values = {
    sourceId: input.sourceId,
    workspaceId: config.workspaceId || null,
    capturedAt,
    displayId: input.displayId,
    segmentDir: toRootRelative(config.storageRoot, input.segmentDir),
    framePath: toRootRelative(config.storageRoot, input.framePath),
    artifactPath: input.snapshotPath ? toRootRelative(config.storageRoot, input.snapshotPath) : null,
    ocrText: input.ocrText,
    appBundleId: input.appBundleId,
    windowTitle: input.windowTitle,
    metadataJson: JSON.stringify({
      frameIndex: input.frameIndex,
      capturePath: input.capturePath ? toRootRelative(config.storageRoot, input.capturePath) : null,
      ocrPath: input.ocrPath ? toRootRelative(config.storageRoot, input.ocrPath) : null,
      snapshotPath: input.snapshotPath ? toRootRelative(config.storageRoot, input.snapshotPath) : null,
      closedEyes: input.closedEyes
        ? {
            status: input.closedEyes.status,
            confidenceBps: input.closedEyes.confidenceBps,
            detector: input.closedEyes.detector,
            discard: input.closedEyes.discard,
            reason: input.closedEyes.reason,
            metadata: input.closedEyes.metadata,
          }
        : null,
      ...input.metadata,
    }),
    updatedAt: now,
  }

  if (existing) {
    db().update(chronicleSnapshots).set(values).where(eq(chronicleSnapshots.id, existing.id)).run()
  }
  else {
    db().insert(chronicleSnapshots).values({ id, ...values, createdAt: now }).run()
    recordEvent({
      type: 'snapshot',
      status: 'success',
      message: 'Chronicle snapshot ingested',
      snapshotId: id,
      attrs: { sourceId: input.sourceId, framePath: values.framePath },
    })
  }
  let accessibilitySnapshotId: string | null = null
  if (input.accessibility) {
    accessibilitySnapshotId = recordAccessibilitySnapshot(input.accessibility, {
      snapshotId: id,
      workspaceId: config.workspaceId || null,
      capturedAt,
      storageRoot: config.storageRoot,
      appBundleId: input.appBundleId,
      windowTitle: input.windowTitle,
    })
  }
  if (!existing) {
    assignActivityEvidence({
      trigger: 'snapshot',
      workspaceId: config.workspaceId || null,
      occurredAt: capturedAt,
      segmentType: inferScreenActivitySegmentType(input.appBundleId, input.windowTitle),
      frontApp: input.appBundleId,
      title: input.windowTitle,
      summary: input.ocrText === null && input.accessibility ? input.accessibility.text : input.ocrText,
      refs: {
        snapshotIds: [id],
        accessibilitySnapshotIds: accessibilitySnapshotId ? [accessibilitySnapshotId] : [],
      },
      metadata: {
        source: 'snapshot',
        sourceId: input.sourceId,
        displayId: input.displayId,
        framePath: values.framePath,
      },
    })
  }
  return db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.id, id)).get()!
}

function getClosedEyesSnapshotDecision(
  config: ChronicleConfig,
  input: ChronicleSnapshotReport,
): { discard: boolean, reason: string } {
  if (!CLOSED_EYES_DISCARD_RUNTIME_ENABLED) {
    return { discard: false, reason: 'closed-eyes discard runtime disabled' }
  }
  if (!config.closedEyesDiscardEnabled || config.closedEyesMode === 'always-record') {
    return { discard: false, reason: 'closed-eyes discard disabled' }
  }
  if (config.closedEyesMode === 'always-pause') {
    return { discard: true, reason: 'closed-eyes mode is always-pause' }
  }
  if (!input.closedEyes) {
    return { discard: false, reason: 'closed-eyes verdict missing' }
  }
  if (input.closedEyes.discard !== null) {
    return {
      discard: input.closedEyes.discard,
      reason: input.closedEyes.reason ?? 'closed-eyes detector provided explicit discard decision',
    }
  }
  if (input.closedEyes.status === 'closed' || input.closedEyes.status === 'absent') {
    return {
      discard: true,
      reason: input.closedEyes.reason ?? `closed-eyes detector reported ${input.closedEyes.status}`,
    }
  }
  return { discard: false, reason: `closed-eyes detector reported ${input.closedEyes.status}` }
}

function recordAccessibilitySnapshot(
  rawInput: AccessibilitySnapshotReportInput,
  context: {
    snapshotId: string
    workspaceId: string | null
    capturedAt: number
    storageRoot: string
    appBundleId: string | null
    windowTitle: string | null
  },
): string {
  const input = AccessibilitySnapshotReportInputSchema.parse(rawInput)
  const now = currentUnixSeconds()
  const existing = db()
    .select()
    .from(chronicleAccessibilitySnapshots)
    .where(eq(chronicleAccessibilitySnapshots.sourceId, input.sourceId))
    .get()
  const id = existing?.id ?? randomUUID()
  const artifactPath = input.accessibilityPath
    ? toRootRelative(context.storageRoot, input.accessibilityPath)
    : null
  const metadata = {
    ...input.metadata,
    ...(artifactPath ? { artifactPath } : {}),
  }
  const values = {
    sourceId: input.sourceId,
    snapshotId: context.snapshotId,
    workspaceId: context.workspaceId,
    capturedAt: context.capturedAt,
    status: input.status,
    provider: input.provider,
    appBundleId: input.appBundleId ?? context.appBundleId,
    windowTitle: input.windowTitle ?? context.windowTitle,
    elementCount: Math.max(0, Math.floor(input.elementCount)),
    text: input.text,
    treeJson: JSON.stringify(input.tree),
    metadataJson: JSON.stringify(metadata),
    updatedAt: now,
  }

  if (existing) {
    db().update(chronicleAccessibilitySnapshots).set(values).where(eq(chronicleAccessibilitySnapshots.id, id)).run()
  }
  else {
    db().insert(chronicleAccessibilitySnapshots).values({
      id,
      ...values,
      createdAt: now,
    }).run()
  }
  return id
}

export function recordAccessibilityEvent(rawInput: AccessibilityEventReportInput): AccessibilityEventEntry {
  const input = AccessibilityEventReportInputSchema.parse(rawInput)
  const config = syncConfig()
  const now = currentUnixSeconds()
  const capturedAt = input.capturedAt
  const existing = db()
    .select()
    .from(chronicleAccessibilityEvents)
    .where(eq(chronicleAccessibilityEvents.sourceId, input.sourceId))
    .get()
  const id = existing?.id ?? randomUUID()
  const metadata = {
    ...input.metadata,
    source: 'accessibility-event',
  }
  const values = {
    sourceId: input.sourceId,
    snapshotId: input.snapshotId,
    accessibilitySnapshotId: input.accessibilitySnapshotId,
    workspaceId: config.workspaceId || null,
    capturedAt,
    provider: input.provider,
    appBundleId: input.appBundleId,
    pid: input.pid,
    notification: input.notification,
    droppedBefore: input.droppedBefore,
    metadataJson: JSON.stringify(metadata),
    updatedAt: now,
  }
  if (!values.notification) {
    throw new AppError({
      code: 'chronicle_accessibility_event_notification_required',
      status: 400,
      message: 'Accessibility event notification is required',
    })
  }

  if (existing) {
    db().update(chronicleAccessibilityEvents).set(values).where(eq(chronicleAccessibilityEvents.id, id)).run()
  }
  else {
    db().insert(chronicleAccessibilityEvents).values({
      id,
      ...values,
      createdAt: now,
    }).run()
    recordEvent({
      type: 'activity',
      status: 'success',
      message: 'Chronicle accessibility event ingested',
      attrs: {
        sourceId: input.sourceId,
        notification: values.notification,
        provider: values.provider,
      },
    })
  }
  return toAccessibilityEventEntry(db().select().from(chronicleAccessibilityEvents).where(eq(chronicleAccessibilityEvents.id, id)).get()!)
}

export function recordMemory(
  rawInput: ChronicleMemoryReportInput,
  rawOptions: z.input<typeof ChronicleMemoryRecordOptionsSchema> = {},
) {
  const input = ChronicleMemoryReportInputSchema.parse(rawInput)
  const options = ChronicleMemoryRecordOptionsSchema.parse(rawOptions)
  reconcileMemorySearchIndex()
  const config = syncConfig()
  const now = currentUnixSeconds()
  const createdAt = input.createdAt
  const canonicalContent = canonicalizeMemoryContent(input.content)
  const contentHash = hashText(canonicalContent)
  const existing = db().select().from(chronicleMemories).where(eq(chronicleMemories.sourceId, input.sourceId)).get()
  const duplicate = findDuplicateMemory(contentHash, canonicalContent, existing?.id)
  const sourceSnapshotIds = options.sourceSnapshotIds ?? findSnapshotIdsByPaths(input.sourceSnapshotPaths)
  const sourcePaths = [...new Set([
    ...(input.memoryPath ? [toRootRelative(config.storageRoot, input.memoryPath)] : []),
    ...input.sourceSnapshotPaths.map(path => toRootRelative(config.storageRoot, path)),
    ...input.sourceFramePaths.map(path => toRootRelative(config.storageRoot, path)),
  ])]
  const values = {
    sourceId: input.sourceId,
    contentHash,
    workspaceId: config.workspaceId || null,
    type: input.windowType,
    source: input.summaryKind,
    content: input.content,
    prompt: options.prompt ?? null,
    sourceSnapshotIdsJson: JSON.stringify(sourceSnapshotIds),
    sourcePathsJson: JSON.stringify(sourcePaths),
    modelProfileId: (options.profileId ?? config.profileId) || null,
    modelId: (options.modelId ?? config.modelId) || null,
    usageJson: JSON.stringify(options.usage),
    metadataJson: JSON.stringify(input.metadata),
    createdAt,
    updatedAt: now,
  }

  if (existing) {
    if (duplicate) {
      const merged = db().transaction((tx) => {
        const row = mergeDuplicateMemory(tx, duplicate, {
          sourceId: input.sourceId,
          sourcePaths,
          sourceSnapshotIds,
          now,
          contentHash,
        })
        tx.delete(chronicleMemories).where(eq(chronicleMemories.id, existing.id)).run()
        return row
      })
      recordEvent({
        type: 'memory',
        status: 'info',
        message: 'Chronicle memory duplicate merged',
        memoryId: merged.id,
        attrs: { sourceId: input.sourceId, duplicateOfSourceId: duplicate.sourceId, contentHash, removedMemoryId: existing.id },
      })
      assignMemoryToActivity(input, merged.id, createdAt, config.workspaceId || null, options)
      return merged
    }

    const updated = db().transaction((tx) => {
      tx.update(chronicleMemories).set(values).where(eq(chronicleMemories.id, existing.id)).run()
      const updated = tx.select().from(chronicleMemories).where(eq(chronicleMemories.id, existing.id)).get()!
      syncMemorySearchIndex(tx, updated)
      return updated
    })
    assignMemoryToActivity(input, updated.id, createdAt, config.workspaceId || null, options)
    return updated
  }

  if (duplicate) {
    const merged = db().transaction(tx => mergeDuplicateMemory(tx, duplicate, {
      sourceId: input.sourceId,
      sourcePaths,
      sourceSnapshotIds,
      now,
      contentHash,
    }))
    recordEvent({
      type: 'memory',
      status: 'info',
      message: 'Chronicle memory duplicate merged',
      memoryId: duplicate.id,
      attrs: { sourceId: input.sourceId, duplicateOfSourceId: duplicate.sourceId, contentHash },
    })
    assignMemoryToActivity(input, merged.id, createdAt, config.workspaceId || null, options)
    return merged
  }

  const id = randomUUID()
  const inserted = db().transaction((tx) => {
    tx.insert(chronicleMemories).values({ id, ...values }).run()
    const row = tx.select().from(chronicleMemories).where(eq(chronicleMemories.id, id)).get()!
    syncMemorySearchIndex(tx, row)
    return row
  })
  recordEvent({
    type: 'memory',
    status: 'success',
    message: 'Chronicle memory ingested',
    memoryId: id,
    attrs: { sourceId: input.sourceId, source: input.summaryKind },
  })
  assignMemoryToActivity(input, inserted.id, createdAt, config.workspaceId || null, options)
  return inserted
}

function assignMemoryToActivity(
  input: ChronicleMemoryReport,
  memoryId: string,
  createdAt: number,
  workspaceId: string | null,
  options: { skipActivityAssignment?: boolean },
): void {
  if (options.skipActivityAssignment) {
    return
  }
  assignActivityEvidence({
    trigger: 'memory',
    workspaceId,
    occurredAt: createdAt,
    segmentType: 'work',
    frontApp: MemoryActivityMetadataSchema.parse(input.metadata).appBundleId,
    title: MemoryActivityMetadataSchema.parse(input.metadata).title,
    summary: input.content.slice(0, 500),
    refs: { memoryIds: [memoryId] },
    metadata: {
      source: 'memory',
      sourceId: input.sourceId,
      summaryKind: input.summaryKind,
      windowType: input.windowType,
    },
  })
}

function inferScreenActivitySegmentType(appBundleId: string | null, windowTitle: string | null): ActivitySegmentType {
  const haystack = `${appBundleId ?? ''} ${windowTitle ?? ''}`.toLowerCase()
  if (haystack.includes('zoom') || haystack.includes('meet') || haystack.includes('teams')) {
    return 'meeting'
  }
  if (haystack.includes('slack') || haystack.includes('discord')) {
    return 'chat'
  }
  if (haystack.includes('browser') || haystack.includes('safari') || haystack.includes('chrome') || haystack.includes('firefox')) {
    return 'browsing'
  }
  return appBundleId || windowTitle ? 'work' : 'unknown'
}

export async function getFrameImageBySnapshot(snapshotId: string): Promise<Response | null> {
  const snapshot = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.id, snapshotId)).get()
  if (!snapshot) {
    return null
  }
  return readFrameImage(snapshot.framePath)
}

export async function getPrivacyMaskedFrameImageBySnapshot(snapshotId: string, input: unknown): Promise<Response | null> {
  const snapshot = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.id, snapshotId)).get()
  if (!snapshot) {
    return null
  }

  const mask = PrivacyFrameMaskInputSchema.parse(input)
  if (!mask.fullFrame && mask.regions.length === 0) {
    throw new AppError({
      code: 'chronicle_privacy_frame_mask_empty',
      status: 400,
      message: 'Frame mask requires fullFrame or at least one region',
    })
  }

  const source = await readFrameImageData(snapshot.framePath)
  if (!source) {
    return null
  }

  const base = sharp(source.data)
  const metadata = await base.metadata()
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (width <= 0 || height <= 0) {
    throw new AppError({
      code: 'chronicle_privacy_frame_mask_invalid_image',
      status: 422,
      message: 'Snapshot frame image dimensions could not be read',
    })
  }

  const output = mask.fullFrame
    ? await base.blur(mask.blurSigma).toBuffer()
    : await maskFrameRegions(source.data, width, height, mask)

  recordPrivacyBreadcrumb({
    kind: 'screenshot-mask',
    status: 'success',
    message: mask.fullFrame ? 'Chronicle privacy blurred full snapshot frame' : 'Chronicle privacy blurred snapshot frame regions',
    snapshotId,
    attrs: {
      mode: mask.mode,
      fullFrame: mask.fullFrame,
      blurSigma: mask.blurSigma,
      regionCount: mask.fullFrame ? 1 : mask.regions.length,
      framePath: snapshot.framePath,
    },
  })

  return new Response(new Uint8Array(output), {
    headers: {
      'Content-Type': source.contentType,
      'Cache-Control': 'no-store',
    },
  })
}

export async function getFrameImage(segment: string, frame: string): Promise<Response | null> {
  return readFrameImage(resolveRelativeJoin(segment, frame))
}

function syncConfig(): ChronicleConfig {
  const filePath = getConfigPath()
  if (!existsSync(filePath)) {
    return ChronicleConfigSchema.parse({})
  }
  const content = readFileSync(filePath, 'utf8')
  return ChronicleConfigJsonSchema.parse(content)
}

function validateSummaryConfig(config: ChronicleConfig): string | null {
  if (!config.enabled) {
    return 'Chronicle is not enabled'
  }
  if (!config.profileId) {
    return 'no provider target set'
  }
  const providerTarget = ProviderTargets.getProviderTarget(config.profileId)
  if (!providerTarget) {
    return 'configured provider target not found'
  }
  if (!providerTarget.enabled) {
    return 'configured provider target disabled'
  }
  return null
}

function resolveProfileApiKey(credentialRef: string | null, configApiKey: string | undefined): string | null {
  if (credentialRef) {
    return readSecret(credentialRef)
  }
  return configApiKey ?? null
}

function getMessageSourceEntry(sourceId: string): MessageSourceEntry {
  const source = db().select().from(chronicleMessageSources).where(eq(chronicleMessageSources.id, sourceId)).get()
  if (!source) {
    throw new AppError({ code: 'chronicle_message_source_not_found', status: 404, message: 'Chronicle message source not found' })
  }
  return toMessageSourceEntry(source)
}

function toMessageSourceEntry(row: typeof chronicleMessageSources.$inferSelect): MessageSourceEntry {
  const sourceConfig = SlackSourceConfigJsonSchema.parse(row.configJson)
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    enabled: row.enabled,
    workspaceId: row.workspaceId,
    teamId: row.teamId,
    botTokenRef: row.botTokenRef,
    channelIds: StringListTextSchema.parse(row.channelIdsJson),
    realtimeMode: sourceConfig.realtimeMode,
    signingSecretRef: sourceConfig.signingSecretRef,
    socketAppTokenRef: sourceConfig.socketAppTokenRef,
    status: row.status,
    lastSyncAt: row.lastSyncAt,
    lastMessageAt: row.lastMessageAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toMessageEntry(row: typeof chronicleMessages.$inferSelect): MessageEntry {
  return {
    id: row.id,
    sourceId: row.sourceId,
    platform: row.platform,
    channelId: row.channelId,
    channelName: row.channelName,
    userName: row.userName,
    text: row.text,
    messageTs: row.messageTs,
    messageAt: new Date(row.messageAt * 1000).toISOString(),
    messageAtUnix: row.messageAt,
    permalink: row.permalink,
  }
}

function toAudioRawSegmentEntry(row: typeof chronicleAudioRawSegments.$inferSelect): AudioRawSegmentEntry {
  return {
    id: row.id,
    sourceId: row.sourceId,
    recordedAt: new Date(row.recordedAt * 1000).toISOString(),
    recordedAtUnix: row.recordedAt,
    source: row.source,
    status: row.status,
    audioPath: row.audioPath,
    metadataPath: row.metadataPath,
    sampleRate: row.sampleRate,
    channels: row.channels,
    sampleCount: row.sampleCount,
    droppedSamples: row.droppedSamples,
    durationMs: row.durationMs,
    rms: bpsToRatio(row.rmsBps),
    peak: bpsToRatio(row.peakBps),
    active: row.active,
    vadStatus: row.vadStatus,
    asrStatus: row.asrStatus,
    speakerStatus: row.speakerStatus,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
  }
}

function toAccessibilitySnapshotEntry(row: typeof chronicleAccessibilitySnapshots.$inferSelect): AccessibilitySnapshotEntry {
  const tree = JsonListTextSchema.parse(row.treeJson)
  return {
    id: row.id,
    sourceId: row.sourceId,
    snapshotId: row.snapshotId,
    capturedAt: new Date(row.capturedAt * 1000).toISOString(),
    capturedAtUnix: row.capturedAt,
    status: row.status,
    provider: row.provider,
    appBundleId: row.appBundleId,
    windowTitle: row.windowTitle,
    elementCount: row.elementCount,
    text: row.text,
    tree,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
  }
}

function toAccessibilityEventEntry(row: typeof chronicleAccessibilityEvents.$inferSelect): AccessibilityEventEntry {
  return {
    id: row.id,
    sourceId: row.sourceId,
    snapshotId: row.snapshotId,
    accessibilitySnapshotId: row.accessibilitySnapshotId,
    capturedAt: new Date(row.capturedAt * 1000).toISOString(),
    capturedAtUnix: row.capturedAt,
    provider: row.provider,
    appBundleId: row.appBundleId,
    pid: row.pid,
    notification: row.notification,
    droppedBefore: row.droppedBefore,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
  }
}

function toActivitySegmentEntry(row: typeof chronicleActivitySegments.$inferSelect): ActivitySegmentEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    startedAt: new Date(row.startedAt * 1000).toISOString(),
    startedAtUnix: row.startedAt,
    endedAt: new Date(row.endedAt * 1000).toISOString(),
    endedAtUnix: row.endedAt,
    durationSeconds: Math.max(0, row.endedAt - row.startedAt),
    segmentType: row.segmentType,
    frontApp: row.frontApp,
    title: row.title,
    summary: row.summary,
    sourceCounts: ActivitySourceCountsJsonSchema.parse(row.sourceCountsJson),
    sourceRefs: ActivitySourceRefsJsonSchema.parse(row.sourceRefsJson),
    pipelineStatus: row.pipelineStatus,
    isCrystallized: row.isCrystallized,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
  }
}

function toActivitySessionEntry(row: typeof chronicleActivitySessions.$inferSelect): ActivitySessionEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    startedAt: new Date(row.startedAt * 1000).toISOString(),
    startedAtUnix: row.startedAt,
    endedAt: row.endedAt === null ? null : new Date(row.endedAt * 1000).toISOString(),
    endedAtUnix: row.endedAt,
    durationSeconds: row.durationSeconds,
    frontApp: row.frontApp,
    title: row.title,
    segmentCount: row.segmentCount,
    snapshotCount: row.snapshotCount,
    messageCount: row.messageCount,
    audioTranscriptCount: row.audioTranscriptCount,
    audioRawSegmentCount: row.audioRawSegmentCount,
    accessibilitySnapshotCount: row.accessibilitySnapshotCount,
    isMeeting: row.isMeeting,
    meetingTitle: row.meetingTitle,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
  }
}

function toActivitySnapshotEntry(row: typeof chronicleSnapshots.$inferSelect): ActivitySnapshotEntry {
  return {
    id: row.id,
    sourceId: row.sourceId,
    workspaceId: row.workspaceId,
    capturedAt: new Date(row.capturedAt * 1000).toISOString(),
    capturedAtUnix: row.capturedAt,
    displayId: row.displayId,
    segmentDir: row.segmentDir,
    framePath: row.framePath,
    artifactPath: row.artifactPath,
    ocrText: row.ocrText,
    appBundleId: row.appBundleId,
    windowTitle: row.windowTitle,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
    updatedAt: new Date(row.updatedAt * 1000).toISOString(),
    updatedAtUnix: row.updatedAt,
  }
}

function toPipelineRunEntry(row: typeof chroniclePipelineRuns.$inferSelect): PipelineRunEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    segmentId: row.segmentId,
    trigger: row.trigger,
    stage: row.stage,
    status: row.status,
    startedAt: new Date(row.startedAt * 1000).toISOString(),
    startedAtUnix: row.startedAt,
    endedAt: row.endedAt === null ? null : new Date(row.endedAt * 1000).toISOString(),
    endedAtUnix: row.endedAt,
    errorMessage: row.errorMessage,
    snapshotsCount: row.snapshotsCount,
    messagesCount: row.messagesCount,
    audioTranscriptsCount: row.audioTranscriptsCount,
    audioRawSegmentsCount: row.audioRawSegmentsCount,
    memoriesCount: row.memoriesCount,
    segmentsCount: row.segmentsCount,
    segmentIds: StringListTextSchema.parse(row.segmentIdsJson),
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
  }
}

function toKnowledgeCardEntry(row: typeof chronicleKnowledgeCards.$inferSelect): KnowledgeCardEntry {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    cardType: row.cardType,
    dimension: row.dimension,
    confidence: bpsToRatio(row.confidenceBps),
    sourceMemoryIds: StringListTextSchema.parse(row.sourceMemoryIdsJson),
    sourceSegmentIds: StringListTextSchema.parse(row.sourceSegmentIdsJson),
    sourceChunkIds: StringListTextSchema.parse(row.sourceChunkIdsJson),
    tags: StringListTextSchema.parse(row.tagsJson),
    contentHash: row.contentHash,
    version: row.version,
    status: row.status,
    mergedIntoId: row.mergedIntoId,
    pinned: row.pinned,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
    updatedAt: new Date(row.updatedAt * 1000).toISOString(),
    updatedAtUnix: row.updatedAt,
  }
}

function toKnowledgeFileEntry(row: typeof chronicleKnowledgeFiles.$inferSelect): KnowledgeFileEntry {
  return {
    id: row.id,
    knowledgeId: row.knowledgeId,
    source: 'attached',
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    filePath: row.filePath,
    embedded: row.embedded,
    evidenceType: null,
    evidenceId: null,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
    updatedAt: new Date(row.updatedAt * 1000).toISOString(),
    updatedAtUnix: row.updatedAt,
  }
}

function inferKnowledgeFilesFromSource(
  knowledgeId: string,
  source: typeof chronicleKnowledgeSources.$inferSelect,
): KnowledgeFileEntry[] {
  const files: KnowledgeFileEntry[] = []
  if (source.memoryId) {
    const memory = db().select().from(chronicleMemories).where(eq(chronicleMemories.id, source.memoryId)).get()
    if (memory) {
      for (const filePath of StringListTextSchema.parse(memory.sourcePathsJson)) {
        files.push(buildInferredKnowledgeFile({
          knowledgeId,
          source: 'memory',
          filePath,
          evidenceType: source.evidenceType,
          evidenceId: source.evidenceId,
          metadata: { memoryId: memory.id, sourceId: memory.sourceId },
        }))
      }
      for (const snapshotId of StringListTextSchema.parse(memory.sourceSnapshotIdsJson)) {
        files.push(...inferKnowledgeFilesFromSnapshotId(knowledgeId, snapshotId, source))
      }
    }
  }
  if (source.evidenceType === 'activity-segment' && source.segmentId) {
    const segment = db().select().from(chronicleActivitySegments).where(eq(chronicleActivitySegments.id, source.segmentId)).get()
    if (segment) {
      const refs = ActivitySourceRefsJsonSchema.parse(segment.sourceRefsJson)
      for (const snapshotId of refs.snapshotIds) {
        files.push(...inferKnowledgeFilesFromSnapshotId(knowledgeId, snapshotId, source))
      }
    }
  }
  if (source.evidenceType === 'snapshot') {
    files.push(...inferKnowledgeFilesFromSnapshotId(knowledgeId, source.evidenceId, source))
  }
  return files
}

function inferKnowledgeFilesFromSnapshotId(
  knowledgeId: string,
  snapshotId: string,
  source: typeof chronicleKnowledgeSources.$inferSelect,
): KnowledgeFileEntry[] {
  const snapshot = db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.id, snapshotId)).get()
  if (!snapshot) {
    return []
  }
  const candidates = [
    { path: snapshot.framePath, contentType: guessKnowledgeFileContentType(snapshot.framePath), label: 'frame' },
    { path: snapshot.artifactPath, contentType: 'application/json', label: 'artifact' },
  ].filter((item): item is { path: string, contentType: string | null, label: string } => Boolean(item.path))
  return candidates.map(item => buildInferredKnowledgeFile({
    knowledgeId,
    source: 'snapshot',
    filePath: item.path,
    contentType: item.contentType,
    evidenceType: source.evidenceType,
    evidenceId: source.evidenceId,
    metadata: { snapshotId, sourceId: snapshot.sourceId, label: item.label },
  }))
}

function buildInferredKnowledgeFile(input: {
  knowledgeId: string
  source: Exclude<KnowledgeFileEntry['source'], 'attached'>
  filePath: string
  contentType?: string | null
  evidenceType: string | null
  evidenceId: string | null
  metadata: Record<string, unknown>
}): KnowledgeFileEntry {
  const evidenceTypeHashPart = input.evidenceType === null ? '' : input.evidenceType
  const evidenceIdHashPart = input.evidenceId === null ? '' : input.evidenceId

  return {
    id: `inferred:${hashText(`${input.knowledgeId}:${input.source}:${input.filePath}:${evidenceTypeHashPart}:${evidenceIdHashPart}`).slice(0, 32)}`,
    knowledgeId: input.knowledgeId,
    source: input.source,
    filename: basename(input.filePath),
    contentType: input.contentType ?? guessKnowledgeFileContentType(input.filePath),
    sizeBytes: null,
    filePath: input.filePath,
    embedded: false,
    evidenceType: input.evidenceType,
    evidenceId: input.evidenceId,
    metadata: input.metadata,
    createdAt: null,
    createdAtUnix: null,
    updatedAt: null,
    updatedAtUnix: null,
  }
}

function guessKnowledgeFileContentType(filePath: string): string | null {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) {
    return 'image/png'
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg'
  }
  if (lower.endsWith('.json')) {
    return 'application/json'
  }
  if (lower.endsWith('.md') || lower.endsWith('.txt')) {
    return 'text/plain'
  }
  return null
}

function toKnowledgeVersionEntry(row: typeof chronicleKnowledgeVersions.$inferSelect): KnowledgeVersionEntry {
  return {
    id: row.id,
    knowledgeId: row.knowledgeId,
    version: row.version,
    title: row.title,
    content: row.content,
    cardType: row.cardType,
    dimension: row.dimension,
    confidence: bpsToRatio(row.confidenceBps),
    sourceMemoryIds: StringListTextSchema.parse(row.sourceMemoryIdsJson),
    sourceSegmentIds: StringListTextSchema.parse(row.sourceSegmentIdsJson),
    sourceChunkIds: StringListTextSchema.parse(row.sourceChunkIdsJson),
    tags: StringListTextSchema.parse(row.tagsJson),
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
  }
}

function toDreamRunEntry(row: typeof chronicleDreamRuns.$inferSelect): DreamRunEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runType: row.runType,
    status: row.status,
    startedAt: new Date(row.startedAt * 1000).toISOString(),
    startedAtUnix: row.startedAt,
    endedAt: row.endedAt === null ? null : new Date(row.endedAt * 1000).toISOString(),
    endedAtUnix: row.endedAt,
    inputCount: row.inputCount,
    outputCount: row.outputCount,
    mergedCount: row.mergedCount,
    deletedCount: row.deletedCount,
    sourceKnowledgeIds: StringListTextSchema.parse(row.sourceKnowledgeIdsJson),
    outputKnowledgeIds: StringListTextSchema.parse(row.outputKnowledgeIdsJson),
    config: JsonRecordTextSchema.parse(row.configJson),
    result: JsonRecordTextSchema.parse(row.resultJson),
    errorMessage: row.errorMessage,
  }
}

function toAudioTranscriptEntry(row: typeof chronicleAudioTranscripts.$inferSelect): AudioTranscriptEntry {
  const segments = db()
    .select()
    .from(chronicleAudioSegments)
    .where(eq(chronicleAudioSegments.transcriptId, row.id))
    .orderBy(chronicleAudioSegments.segmentIndex)
    .all()
    .map(toAudioSegmentEntry)

  return {
    id: row.id,
    sourceId: row.sourceId,
    memoryId: row.memoryId,
    title: row.title,
    source: row.source,
    status: row.status,
    startedAt: new Date(row.startedAt * 1000).toISOString(),
    startedAtUnix: row.startedAt,
    endedAt: row.endedAt === null ? null : new Date(row.endedAt * 1000).toISOString(),
    endedAtUnix: row.endedAt,
    language: row.language,
    appBundleId: row.appBundleId,
    windowTitle: row.windowTitle,
    segmentCount: segments.length,
    previewText: segments.map(segment => segment.text).join(' ').slice(0, 500),
    segments,
  }
}

function toAudioSegmentEntry(row: typeof chronicleAudioSegments.$inferSelect): AudioTranscriptSegmentEntry {
  return {
    id: row.id,
    segmentIndex: row.segmentIndex,
    startMs: row.startMs,
    endMs: row.endMs,
    speakerLabel: row.speakerLabel,
    text: row.text,
    confidence: row.confidenceBps === null ? null : row.confidenceBps / 10_000,
    language: row.language,
  }
}

function toSpeakerProfileEntry(row: typeof chronicleSpeakerProfiles.$inferSelect): SpeakerProfileEntry {
  const embedding = row.embeddingJson ? NumberListTextSchema.parse(row.embeddingJson) : null
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    displayName: row.displayName,
    normalizedLabel: row.normalizedLabel,
    aliases: StringListTextSchema.parse(row.aliasesJson),
    embedding,
    embeddingDimensions: row.embeddingDimensions,
    embeddingModelId: row.embeddingModelId,
    sampleCount: row.sampleCount,
    lastSeenAt: row.lastSeenAt === null ? null : new Date(row.lastSeenAt * 1000).toISOString(),
    lastSeenAtUnix: row.lastSeenAt,
    sourceTranscriptId: row.sourceTranscriptId,
    sourceSegmentId: row.sourceSegmentId,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
    updatedAt: new Date(row.updatedAt * 1000).toISOString(),
    updatedAtUnix: row.updatedAt,
  }
}

function buildAudioTranscriptPreview(transcriptId: string): string {
  return db()
    .select({ text: chronicleAudioSegments.text })
    .from(chronicleAudioSegments)
    .where(eq(chronicleAudioSegments.transcriptId, transcriptId))
    .orderBy(chronicleAudioSegments.segmentIndex)
    .limit(4)
    .all()
    .map(row => row.text)
    .join(' ')
}

function buildAudioTranscriptMemoryContent(input: {
  title: string | null
  startedAt: number
  segments: AudioTranscriptSegmentInput[]
}): string {
  const heading = input.title?.trim()
    ? `Meeting transcript: ${input.title.trim()}`
    : `Meeting transcript: ${new Date(input.startedAt * 1000).toISOString()}`
  const body = input.segments
    .map((segment) => {
      const speaker = segment.speakerLabel?.trim() || 'Speaker'
      const start = buildTranscriptOffsetLabel(segment.startMs)
      return `[${start}] ${speaker}: ${segment.text.trim()}`
    })
    .filter(line => line.length > 0)
    .join('\n')
  return `${heading}\n\n${body}`.trim()
}

function buildTranscriptOffsetLabel(valueMs: number): string {
  return formatDuration(Math.max(0, valueMs), { leading: true })
}

function updateMessageSourceStatus(
  sourceId: string,
  status: typeof chronicleMessageSources.$inferSelect.status,
  lastError: string | null,
): void {
  db().update(chronicleMessageSources).set({
    status,
    lastError,
    updatedAt: currentUnixSeconds(),
  }).where(eq(chronicleMessageSources.id, sourceId)).run()
}

function failSlackSync(
  sourceId: string,
  message: string,
  trigger: SlackSyncTrigger = 'manual',
): { sourceId: string, status: 'error', ingested: 0, message: string } {
  updateMessageSourceStatus(sourceId, 'error', message)
  recordEvent({
    type: 'message',
    status: 'error',
    message,
    attrs: { sourceId, trigger },
  })
  return { sourceId, status: 'error', ingested: 0, message }
}

function mergeSlackSourceConfig(
  configJson: string,
  patch: {
    realtimeMode?: SlackConfigurableRealtimeMode
    signingSecretRef?: string | null
    socketAppTokenRef?: string | null
  },
): SlackSourceConfig {
  const current = SlackSourceConfigJsonSchema.parse(configJson)
  return SlackSourceConfigPatchSchema.parse({
    current,
    patch: {
      realtimeMode: patch.realtimeMode,
      signingSecretRef: patch.signingSecretRef,
      socketAppTokenRef: patch.socketAppTokenRef,
    },
  })
}

const SlackHistoryResponseSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  messages: z.array(z.record(z.string(), z.unknown())).default([]),
})

const SlackChannelInfoResponseSchema = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  channel: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
})

function verifySlackSignature(input: {
  rawBody: string
  signature: string | null
  timestamp: string | null
  signingSecret: string
}): void {
  const parsedInput = SlackSignatureInputSchema.parse(input)
  const now = currentUnixSeconds()
  if (Math.abs(now - parsedInput.timestampSeconds) > SLACK_SIGNATURE_TOLERANCE_SECONDS) {
    throw new AppError({
      code: 'chronicle_slack_timestamp_stale',
      status: 401,
      message: 'Slack request timestamp is outside the accepted window',
    })
  }

  const base = `${SLACK_SIGNATURE_VERSION}:${parsedInput.timestamp}:${parsedInput.rawBody}`
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac('sha256', parsedInput.signingSecret).update(base).digest('hex')}`
  if (!safeEqualText(parsedInput.signature, expected)) {
    throw new AppError({
      code: 'chronicle_slack_signature_invalid',
      status: 401,
      message: 'Slack signature is invalid',
    })
  }
}

function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

async function fetchSlackHistory(token: string, channelId: string, oldestUnix: number | null): Promise<Record<string, unknown>[]> {
  const url = new URL('https://slack.com/api/conversations.history')
  url.searchParams.set('channel', channelId)
  url.searchParams.set('limit', '100')
  if (oldestUnix) {
    url.searchParams.set('oldest', String(oldestUnix))
    url.searchParams.set('inclusive', 'false')
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Slack history request failed: ${response.status}`)
  }
  const payload = SlackHistoryResponseSchema.parse(await response.json())
  if (!payload.ok) {
    throw new Error(`Slack history request failed: ${payload.error ?? 'unknown_error'}`)
  }
  return payload.messages
}

async function fetchSlackChannelNames(token: string, channelIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (const channelId of channelIds) {
    const url = new URL('https://slack.com/api/conversations.info')
    url.searchParams.set('channel', channelId)
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      continue
    }
    const payload = SlackChannelInfoResponseSchema.parse(await response.json())
    if (payload.ok && payload.channel?.name) {
      names.set(channelId, payload.channel.name)
    }
  }
  return names
}

function recordSlackMessage(input: {
  sourceId: string
  workspaceId: string | null
  teamId: string | null
  channelId: string
  channelName: string | null
  userId: string | null
  userName: string | null
  text: string
  messageTs: string
  threadId: string
  permalink: string | null
  raw: Record<string, unknown>
}): boolean {
  const externalMessageId = `${input.channelId}:${input.messageTs}`
  const existing = db()
    .select({ id: chronicleMessages.id })
    .from(chronicleMessages)
    .where(sql`${chronicleMessages.sourceId} = ${input.sourceId} AND ${chronicleMessages.externalMessageId} = ${externalMessageId}`)
    .get()
  if (existing) {
    return false
  }

  const now = currentUnixSeconds()
  const messageAt = slackTsToUnix(input.messageTs)
  const dedupHash = createHash('sha256')
    .update(JSON.stringify({
      sourceId: input.sourceId,
      channelId: input.channelId,
      messageTs: input.messageTs,
      text: input.text,
    }))
    .digest('hex')
  const id = randomUUID()
  db().insert(chronicleMessages).values({
    id,
    sourceId: input.sourceId,
    workspaceId: input.workspaceId,
    platform: 'slack',
    externalMessageId,
    teamId: input.teamId,
    channelId: input.channelId,
    channelName: input.channelName,
    threadId: input.threadId,
    userId: input.userId,
    userName: input.userName,
    text: input.text,
    isDm: input.channelId.startsWith('D'),
    messageTs: input.messageTs,
    messageAt,
    permalink: input.permalink,
    attachmentsJson: JSON.stringify(SlackAttachmentsSchema.parse(input.raw.attachments)),
    rawJson: JSON.stringify(input.raw),
    dedupHash,
    createdAt: now,
    updatedAt: now,
  }).run()

  const channelLabel = input.channelName ? `#${input.channelName}` : input.channelId
  const memory = recordMemory({
    sourceId: `slack:${input.sourceId}:${externalMessageId}`,
    windowType: '10min',
    createdAt: new Date(messageAt * 1000).toISOString(),
    content: `[Slack ${channelLabel}] ${input.userName ?? input.userId ?? 'unknown'}: ${input.text}`,
    summaryKind: 'imported',
    metadata: {
      platform: 'slack',
      messageId: id,
      sourceId: input.sourceId,
      channelId: input.channelId,
      channelName: input.channelName,
      messageTs: input.messageTs,
    },
  }, { skipActivityAssignment: true })
  assignActivityEvidence({
    trigger: 'message',
    workspaceId: input.workspaceId,
    occurredAt: messageAt,
    segmentType: 'chat',
    frontApp: 'slack',
    title: input.channelName ?? input.channelId,
    summary: input.text.slice(0, 500),
    refs: { messageIds: [id], memoryIds: [memory.id] },
    metadata: {
      source: 'slack',
      sourceId: input.sourceId,
      externalMessageId,
      channelId: input.channelId,
      messageTs: input.messageTs,
    },
  })
  return true
}

function slackTsToUnix(value: string): number {
  return SlackTimestampTextSchema.parse(value)
}

async function getConfiguredModel(config: ChronicleConfig): Promise<string | null> {
  if (!config.profileId) {
    return null
  }
  const providerTarget = ProviderTargets.getProviderTarget(config.profileId)
  if (!providerTarget) {
    return null
  }
  const parsedConfig = ProfileConfigJsonSchema.parse(providerTarget.connectionConfigJson)
  return config.modelId || parsedConfig.modelId || parsedConfig.model || null
}

function recordEvent(rawInput: z.input<typeof ChronicleEventInputSchema>) {
  const input = ChronicleEventInputSchema.parse(rawInput)
  db().insert(chronicleEvents).values({
    id: randomUUID(),
    type: input.type,
    status: input.status,
    message: input.message,
    snapshotId: input.snapshotId,
    memoryId: input.memoryId,
    attrsJson: JSON.stringify(input.attrs),
    createdAt: currentUnixSeconds(),
  }).run()
}

function seedModelResources(): void {
  const now = currentUnixSeconds()
  const d = db()
  for (const manifest of Object.values(builtInModelManifests)) {
    const existing = d.select().from(chronicleModelResources).where(eq(chronicleModelResources.category, manifest.category)).get()
    if (existing) {
      // Always refresh metadata to pick up manifest changes (e.g. new sourceUrls)
      d.update(chronicleModelResources).set({
        metadataJson: JSON.stringify(buildModelResourceMetadata(manifest)),
        displayName: manifest.displayName,
        version: manifest.version,
      }).where(eq(chronicleModelResources.id, existing.id)).run()
      continue
    }
    const status = manifest.files.length === 0 ? 'available' : 'missing'
    d.insert(chronicleModelResources).values({
      id: randomUUID(),
      category: manifest.category,
      status,
      displayName: manifest.displayName,
      path: null,
      version: manifest.version,
      message: manifest.message,
      sizeBytes: 0,
      metadataJson: JSON.stringify(buildModelResourceMetadata(manifest)),
      createdAt: now,
      updatedAt: now,
    }).run()
  }
}

function listModelResourceRows(): ModelResourceEntry[] {
  return db()
    .select()
    .from(chronicleModelResources)
    .orderBy(chronicleModelResources.category)
    .all()
    .map(row => ({
      id: row.id,
      category: row.category,
      status: row.status,
      displayName: row.displayName,
      path: row.path,
      version: row.version,
      message: row.message,
      sizeBytes: row.sizeBytes,
      metadata: JsonRecordTextSchema.parse(row.metadataJson),
      updatedAt: row.updatedAt,
    }))
}

function getModelResourceRow(category: ModelResourceCategory): typeof chronicleModelResources.$inferSelect {
  seedModelResources()
  const row = db().select().from(chronicleModelResources).where(eq(chronicleModelResources.category, category)).get()
  if (!row) {
    throw new AppError({
      code: 'chronicle_model_resource_not_found',
      status: 404,
      message: 'Chronicle model resource not found',
    })
  }
  return row
}

function getModelResourceEntry(category: ModelResourceCategory): ModelResourceEntry {
  const row = getModelResourceRow(category)
  return {
    id: row.id,
    category: row.category,
    status: row.status,
    displayName: row.displayName,
    path: row.path,
    version: row.version,
    message: row.message,
    sizeBytes: row.sizeBytes,
    metadata: JsonRecordTextSchema.parse(row.metadataJson),
    updatedAt: row.updatedAt,
  }
}

function getModelResourceManifest(category: ModelResourceCategory): ModelResourceManifest {
  return builtInModelManifests[category]
}

function getModelResourcesRoot(): string {
  const config = getServerConfig()
  const namespaceRoot = config.dataDir
    ? resolve(config.dataDir, 'chronicle')
    : resolve(homedir(), '.cradle', 'chronicle')
  return resolve(namespaceRoot, 'models')
}

function getModelResourceAbsolutePath(relativePath: string): string {
  const root = getModelResourcesRoot()
  const target = resolve(root, relativePath)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AppError({
      code: 'chronicle_model_resource_path_invalid',
      status: 400,
      message: 'Model resource path must stay under Chronicle models root',
    })
  }
  return target
}

function rootRelativeModelPath(absolutePath: string): string {
  const root = getModelResourcesRoot()
  const rel = relative(root, resolve(absolutePath))
  return rel.startsWith('..') || isAbsolute(rel) ? absolutePath : rel
}

function buildModelResourceMetadata(
  manifest: ModelResourceManifest,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...manifest.metadata,
    manifest: {
      category: manifest.category,
      version: manifest.version,
      runtime: manifest.runtime,
      required: manifest.required,
      files: manifest.files,
    },
    modelsRoot: getModelResourcesRoot(),
    ...extra,
  }
}

async function checkModelResourceFiles(manifest: ModelResourceManifest): Promise<ModelResourceFileCheck[]> {
  const checks: ModelResourceFileCheck[] = []
  for (const file of manifest.files) {
    const absolutePath = getModelResourceAbsolutePath(file.path)
    const stats = await stat(absolutePath).catch(() => null)
    const exists = !!stats?.isFile()
    const actualSha256 = exists && file.sha256 ? await sha256File(absolutePath) : undefined
    checks.push({
      relativePath: file.path,
      absolutePath,
      required: file.required !== false,
      exists,
      expectedSizeBytes: file.sizeBytes,
      actualSizeBytes: stats?.isFile() ? stats.size : undefined,
      sha256: file.sha256,
      actualSha256,
    })
  }
  return checks
}

function assertManifestInstallAllowed(manifest: ModelResourceManifest): void {
  const unsafeFiles = manifest.files.filter(file => !file.sourceUrl)
  if (unsafeFiles.length > 0) {
    throw new AppError({
      code: 'chronicle_model_resource_manifest_unverified',
      status: 400,
      message: 'Manifest install requires a source URL for every file',
    })
  }
}

async function resolveModelResourceLocalSource(
  files: ModelResourceLocalFileInput[],
  sourceRoot: string | null,
  manifestFile: ModelResourceFileManifest,
  manifestFileCount: number,
): Promise<string> {
  const direct = files.find(file => file.relativePath === manifestFile.path)
  const fallbackName = basename(manifestFile.path)
  const byName = fallbackName ? files.find(file => file.relativePath === fallbackName) : undefined
  const sourcePath = (direct ?? byName)?.sourcePath ?? null
  if (sourcePath) {
    return assertLocalModelSourceFile(sourcePath, manifestFile.path)
  }

  if (sourceRoot) {
    const root = resolve(sourceRoot)
    const rootStats = await stat(root).catch(() => null)
    if (rootStats?.isFile() && manifestFileCount === 1) {
      return root
    }
    if (rootStats?.isDirectory()) {
      const relativeCandidate = resolve(root, manifestFile.path)
      if (await isFile(relativeCandidate)) {
        return relativeCandidate
      }
      const basenameCandidate = resolve(root, basename(manifestFile.path))
      if (await isFile(basenameCandidate)) {
        return basenameCandidate
      }
    }
  }

  throw new AppError({
    code: 'chronicle_model_resource_file_missing',
    status: 400,
    message: `Missing source file for ${manifestFile.path}`,
  })
}

async function assertLocalModelSourceFile(sourcePath: string, manifestPath: string): Promise<string> {
  const resolved = resolve(sourcePath)
  const stats = await stat(resolved).catch(() => null)
  if (!stats?.isFile()) {
    throw new AppError({
      code: 'chronicle_model_resource_source_invalid',
      status: 400,
      message: `Model source file does not exist: ${manifestPath}`,
    })
  }
  return resolved
}

async function isFile(path: string): Promise<boolean> {
  return !!(await stat(path).catch(() => null))?.isFile()
}

async function verifyStagedModelFile(file: ModelResourceFileManifest, path: string): Promise<void> {
  const stats = await stat(path)
  if (!stats.isFile()) {
    throw new Error(`Model resource is not a file: ${file.path}`)
  }
  if (file.sizeBytes !== undefined && stats.size !== file.sizeBytes) {
    throw new Error(`Size check failed for ${file.path}`)
  }
  if (file.sha256) {
    const actualSha256 = await sha256File(path)
    if (actualSha256 !== file.sha256) {
      throw new Error(`Checksum failed for ${file.path}`)
    }
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

async function downloadModelResourceFile(file: ModelResourceFileManifest, targetPath: string, category: string): Promise<void> {
  const urls = [file.sourceUrl, ...file.fallbackUrls].filter((url): url is string => !!url)
  let lastError: unknown = null
  const progressContext = { category, file: file.path }
  for (const url of urls) {
    // Retry each URL up to 3 times with exponential backoff
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await downloadToFile(url, targetPath, progressContext)
        return
      }
      catch (error) {
        lastError = error
        await rm(targetPath, { force: true }).catch(() => {})
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
        }
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : 'no source URL'
  emitDownloadProgress({ ...progressContext, totalBytes: null, downloadedBytes: 0, status: 'error', error: message, startedAt: Date.now() })
  throw new Error(`Model resource download failed for ${file.path}: ${message}`)
}

async function downloadToFile(sourceUrl: string, targetPath: string, progressContext?: { category: string, file: string }): Promise<void> {
  const parsed = new URL(sourceUrl)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError({
      code: 'chronicle_model_resource_url_invalid',
      status: 400,
      message: 'Model resource URL must use http or https',
    })
  }
  const controller = new AbortController()
  const timeoutMs = ModelResourceFetchTimeoutMsSchema.parse(process.env.CRADLE_MODEL_RESOURCE_FETCH_TIMEOUT_MS)
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'Cradle/1.0' },
      redirect: 'follow',
      signal: controller.signal,
    })
  }
  catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Model resource download timed out after ${timeoutMs} ms`)
    }
    throw error
  }
  finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    throw new Error(`Model resource download failed: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('Model resource download returned no body')
  }

  const contentLength = response.headers.get('content-length')
  const totalBytes = contentLength ? Number.parseInt(contentLength, 10) : null

  if (progressContext) {
    emitDownloadProgress({
      category: progressContext.category,
      file: progressContext.file,
      totalBytes,
      downloadedBytes: 0,
      status: 'downloading',
      startedAt: Date.now(),
    })
  }

  const nodeStream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
  const fileStream = createWriteStream(targetPath)

  let downloadedBytes = 0
  nodeStream.on('data', (chunk: Buffer) => {
    downloadedBytes += chunk.length
    if (progressContext) {
      emitDownloadProgress({
        category: progressContext.category,
        file: progressContext.file,
        totalBytes,
        downloadedBytes,
        status: 'downloading',
        startedAt: Date.now(),
      })
    }
  })

  await pipeline(nodeStream, fileStream)

  if (progressContext) {
    emitDownloadProgress({
      category: progressContext.category,
      file: progressContext.file,
      totalBytes,
      downloadedBytes,
      status: 'done',
      startedAt: Date.now(),
    })
  }
}

async function readFrameImage(relativeOrAbsolutePath: string): Promise<Response | null> {
  const image = await readFrameImageData(relativeOrAbsolutePath)
  if (!image) {
    return null
  }

  return new Response(new Uint8Array(image.data), { headers: { 'Content-Type': image.contentType } })
}

async function readFrameImageData(relativeOrAbsolutePath: string): Promise<{ data: Buffer, contentType: string } | null> {
  const resolvedPath = await resolveFrameImagePath(relativeOrAbsolutePath)
  if (!resolvedPath) {
    return null
  }
  try {
    const data = await readFile(resolvedPath)
    return { data, contentType: getFrameImageContentType(resolvedPath) }
  }
  catch {
    return null
  }
}

async function resolveFrameImagePath(relativeOrAbsolutePath: string): Promise<string | null> {
  const config = await getConfig()
  const storageRoot = resolve(config.storageRoot)
  const resolvedPath = isAbsolute(relativeOrAbsolutePath)
    ? resolve(relativeOrAbsolutePath)
    : resolve(storageRoot, relativeOrAbsolutePath)
  const rel = relative(storageRoot, resolvedPath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return null
  }
  return resolvedPath
}

function getFrameImageContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'png') {
    return 'image/png'
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    return 'image/jpeg'
  }
  return 'application/octet-stream'
}

async function maskFrameRegions(
  source: Buffer,
  imageWidth: number,
  imageHeight: number,
  mask: z.infer<typeof PrivacyFrameMaskInputSchema>,
): Promise<Buffer> {
  const overlays = await Promise.all(mask.regions.flatMap((region) => {
    const left = Math.max(0, Math.floor(region.x))
    const top = Math.max(0, Math.floor(region.y))
    const width = Math.min(imageWidth - left, Math.floor(region.width))
    const height = Math.min(imageHeight - top, Math.floor(region.height))
    if (width <= 0 || height <= 0) {
      return []
    }
    return [sharp(source)
      .extract({ left, top, width, height })
      .blur(mask.blurSigma)
      .toBuffer()
      .then(input => ({ input, left, top }))]
  }))

  if (overlays.length === 0) {
    throw new AppError({
      code: 'chronicle_privacy_frame_mask_regions_outside_image',
      status: 400,
      message: 'Frame mask regions are outside the source image',
    })
  }

  return sharp(source)
    .composite(overlays)
    .toBuffer()
}

function toMemoryEntry(
  row: typeof chronicleMemories.$inferSelect,
  match?: MemorySearchScore,
): MemoryEntry {
  const keywordScore = match?.keywordScore ?? 0
  const semanticScore = match?.semanticScore ?? 0
  const matchKind = keywordScore > 0 && semanticScore > 0
    ? 'hybrid'
    : semanticScore > 0
      ? 'semantic'
      : keywordScore > 0
        ? 'keyword'
        : null

  return {
    id: row.id,
    type: row.type,
    source: row.source,
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    createdAtUnix: row.createdAt,
    content: row.content,
    modelId: row.modelId,
    matchKind,
    keywordScore: matchKind ? Number(keywordScore.toFixed(4)) : null,
    semanticScore: matchKind ? Number(semanticScore.toFixed(4)) : null,
  }
}

function reconcileMemorySearchIndex(): void {
  const currentDbPath = getServerConfig().dbPath
  if (memorySearchIndexReconciledDbPath === currentDbPath) {
    return
  }
  const memories = db().select().from(chronicleMemories).all()
  db().transaction((tx) => {
    for (const memory of memories) {
      const contentHash = memory.contentHash ?? hashText(canonicalizeMemoryContent(memory.content))
      const chunkExists = tx
        .select({ id: chronicleMemoryChunks.id })
        .from(chronicleMemoryChunks)
        .where(eq(chronicleMemoryChunks.memoryId, memory.id))
        .limit(1)
        .get()
      const keywordExists = tx
        .select({ id: chronicleMemoryKeywords.id })
        .from(chronicleMemoryKeywords)
        .where(eq(chronicleMemoryKeywords.memoryId, memory.id))
        .limit(1)
        .get()
      const embeddingExists = tx
        .select({ id: chronicleMemoryEmbeddings.id })
        .from(chronicleMemoryEmbeddings)
        .where(eq(chronicleMemoryEmbeddings.memoryId, memory.id))
        .limit(1)
        .get()
      const nextMemory = memory.contentHash === contentHash
        ? memory
        : { ...memory, contentHash }

      if (memory.contentHash !== contentHash) {
        tx.update(chronicleMemories).set({
          contentHash,
          updatedAt: Math.max(memory.updatedAt, currentUnixSeconds()),
        }).where(eq(chronicleMemories.id, memory.id)).run()
      }
      if (!chunkExists || !keywordExists || !embeddingExists) {
        syncMemorySearchIndex(tx, nextMemory)
      }
    }
  })
  memorySearchIndexReconciledDbPath = currentDbPath
}

function findDuplicateMemory(
  contentHash: string,
  canonicalContent: string,
  excludeMemoryId?: string,
): typeof chronicleMemories.$inferSelect | null {
  return db()
    .select()
    .from(chronicleMemories)
    .where(eq(chronicleMemories.contentHash, contentHash))
    .all()
    .find(row => row.id !== excludeMemoryId && canonicalizeMemoryContent(row.content) === canonicalContent)
    ?? null
}

function mergeDuplicateMemory(
  tx: ChronicleTx,
  duplicate: typeof chronicleMemories.$inferSelect,
  input: {
    sourceId: string
    sourcePaths: string[]
    sourceSnapshotIds: string[]
    now: number
    contentHash: string
  },
): typeof chronicleMemories.$inferSelect {
  const mergedSourceIds = [...new Set([
    ...DuplicateMemoryMetadataTextSchema.parse(duplicate.metadataJson).duplicateSourceIds,
    input.sourceId,
  ])]
  const mergedSourcePaths = [...new Set([
    ...StringListTextSchema.parse(duplicate.sourcePathsJson),
    ...input.sourcePaths,
  ])]
  const mergedSourceSnapshotIds = [...new Set([
    ...StringListTextSchema.parse(duplicate.sourceSnapshotIdsJson),
    ...input.sourceSnapshotIds,
  ])]
  const metadata = {
    ...JsonRecordTextSchema.parse(duplicate.metadataJson),
    duplicateSourceIds: mergedSourceIds,
    duplicateLastSeenAt: input.now,
  }
  tx.update(chronicleMemories).set({
    contentHash: input.contentHash,
    sourceSnapshotIdsJson: JSON.stringify(mergedSourceSnapshotIds),
    sourcePathsJson: JSON.stringify(mergedSourcePaths),
    metadataJson: JSON.stringify(metadata),
    updatedAt: input.now,
  }).where(eq(chronicleMemories.id, duplicate.id)).run()
  const merged = tx.select().from(chronicleMemories).where(eq(chronicleMemories.id, duplicate.id)).get()!
  syncMemorySearchIndex(tx, merged)
  return merged
}

function syncMemorySearchIndex(tx: ChronicleTx, memory: typeof chronicleMemories.$inferSelect): void {
  const now = currentUnixSeconds()
  tx.delete(chronicleMemoryKeywords).where(eq(chronicleMemoryKeywords.memoryId, memory.id)).run()
  tx.delete(chronicleMemoryEmbeddings).where(eq(chronicleMemoryEmbeddings.memoryId, memory.id)).run()
  tx.delete(chronicleMemoryChunks).where(eq(chronicleMemoryChunks.memoryId, memory.id)).run()

  const chunks = splitMemoryContent(memory.content)
  for (const [chunkIndex, chunkContent] of chunks.entries()) {
    const chunkId = randomUUID()
    const contentTerms = countTerms(tokenizeMemoryText(chunkContent))
    const promptTerms = countTerms(tokenizeMemoryText(memory.prompt ?? ''))
    const metadataTerms = countTerms(tokenizeMemoryText(memory.metadataJson))
    const tokenCount = [...contentTerms.values()].reduce((sum, count) => sum + count, 0)

    tx.insert(chronicleMemoryChunks).values({
      id: chunkId,
      memoryId: memory.id,
      chunkIndex,
      content: chunkContent,
      contentHash: hashText(canonicalizeMemoryContent(chunkContent)),
      tokenCount,
      embeddingStatus: 'missing',
      embeddingModelId: null,
      metadataJson: JSON.stringify({
        source: 'chronicle-memory',
        contentHash: memory.contentHash,
      }),
      createdAt: now,
      updatedAt: now,
    }).run()

    insertMemoryKeywords(tx, memory.id, chunkId, 'content', contentTerms, 3, now)
    insertMemoryKeywords(tx, memory.id, chunkId, 'prompt', promptTerms, 2, now)
    insertMemoryKeywords(tx, memory.id, chunkId, 'metadata', metadataTerms, 1, now)
    insertMemoryEmbedding(tx, memory.id, chunkId, chunkContent, now)
  }
}

function insertMemoryEmbedding(
  tx: ChronicleTx,
  memoryId: string,
  chunkId: string,
  content: string,
  now: number,
): void {
  const embedding = buildTextEmbeddingVector(content)
  const vectorJson = JSON.stringify(embedding.vector)
  tx.insert(chronicleMemoryEmbeddings).values({
    id: randomUUID(),
    memoryId,
    chunkId,
    modelId: embedding.modelId,
    modelVersion: embedding.modelVersion,
    dimensions: embedding.vector.length,
    vectorJson,
    vectorHash: hashText(vectorJson),
    status: 'ready',
    metadataJson: JSON.stringify({
      provider: embedding.provider === 'onnx' ? 'chronicle-onnx' : 'chronicle-lexical',
      runtime: embedding.provider === 'onnx' ? 'local-onnx' : 'deterministic-local',
    }),
    createdAt: now,
    updatedAt: now,
  }).run()

  if (embedding.provider === 'onnx') {
    tx.update(chronicleMemoryChunks).set({
      embeddingStatus: 'ready',
      embeddingModelId: embedding.modelId,
      updatedAt: now,
    }).where(eq(chronicleMemoryChunks.id, chunkId)).run()
  }
}

function insertMemoryKeywords(
  tx: ChronicleTx,
  memoryId: string,
  chunkId: string,
  source: 'content' | 'prompt' | 'metadata',
  terms: Map<string, number>,
  weight: number,
  createdAt: number,
): void {
  for (const [term, occurrences] of terms) {
    tx.insert(chronicleMemoryKeywords).values({
      id: randomUUID(),
      memoryId,
      chunkId,
      term,
      source,
      occurrences,
      weight,
      createdAt,
    }).run()
  }
}

function splitMemoryContent(content: string): string[] {
  const trimmed = content.trim()
  if (!trimmed) {
    return ['']
  }
  const chunks: string[] = []
  for (let offset = 0; offset < trimmed.length; offset += MEMORY_CHUNK_MAX_CHARS) {
    chunks.push(trimmed.slice(offset, offset + MEMORY_CHUNK_MAX_CHARS))
  }
  return chunks
}

function canonicalizeMemoryContent(content: string): string {
  return content
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function tokenizeMemoryText(text: string): string[] {
  const normalized = canonicalizeMemoryContent(text)
  const matches = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? []
  return matches
    .map(term => term.replace(/^[-_]+|[-_]+$/g, ''))
    .filter(term => term.length >= MEMORY_TOKEN_MIN_LENGTH)
}

function countTerms(terms: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const term of terms) {
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  return counts
}

function buildCombinedMemorySearchScore(match: MemorySearchScore, phraseContained: boolean): number {
  const phraseBoost = phraseContained ? 100 : 0
  return phraseBoost + match.keywordScore + match.semanticScore * MEMORY_SEMANTIC_SCORE_WEIGHT
}

function currentTextEmbeddingVectorMode(): string {
  return getOnnxEmbeddingRuntimeHealth().ok
    ? `${ONNX_TEXT_EMBEDDING_MODEL_ID}/${ONNX_TEXT_EMBEDDING_MODEL_VERSION}`
    : `${MEMORY_EMBEDDING_MODEL_ID}/${MEMORY_EMBEDDING_MODEL_VERSION}`
}

function buildTextEmbeddingVector(text: string): TextEmbeddingVector {
  if (getOnnxEmbeddingRuntimeHealth().ok) {
    try {
      const response = EmbeddingBatchSchema.parse(DaemonManager.runEmbeddingBatch([text], getModelResourcesRoot()))
      if (response.embeddings.length !== 1) {
        throw new Error('embedding response has an invalid embedding count')
      }
      return {
        vector: response.embeddings[0]!,
        modelId: response.modelId,
        modelVersion: response.modelVersion,
        provider: 'onnx',
      }
    }
    catch (error) {
      recordEvent({
        type: 'model-resource',
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        attrs: { category: 'embedding', runtime: 'local-onnx' },
      })
    }
  }

  return {
    vector: buildLexicalEmbeddingVector(text),
    modelId: MEMORY_EMBEDDING_MODEL_ID,
    modelVersion: MEMORY_EMBEDDING_MODEL_VERSION,
    provider: 'lexical',
  }
}

function onnxEmbeddingResourceAvailable(): boolean {
  const manifest = getModelResourceManifest('embedding')
  return manifest.files
    .filter(file => file.required !== false)
    .every(file => existsSync(getModelResourceAbsolutePath(file.path)))
}

function clearEmbeddingRuntimeHealth(): void {
  embeddingRuntimeHealth = null
}

function getOnnxEmbeddingRuntimeHealth(): { ok: boolean, error: string | null } {
  if (!onnxEmbeddingResourceAvailable()) {
    return {
      ok: false,
      error: 'Chronicle ONNX embedding model is not installed',
    }
  }

  const now = Date.now()
  if (embeddingRuntimeHealth && now - embeddingRuntimeHealth.checkedAtMs < EMBEDDING_RUNTIME_HEALTH_CACHE_MS) {
    return {
      ok: embeddingRuntimeHealth.ok,
      error: embeddingRuntimeHealth.error,
    }
  }

  try {
    const response = EmbeddingBatchSchema.parse(DaemonManager.runEmbeddingBatch(
      ['chronicle embedding health probe'],
      getModelResourcesRoot(),
      { timeoutMs: EMBEDDING_RUNTIME_HEALTH_TIMEOUT_MS },
    ))
    if (response.embeddings.length !== 1) {
      throw new Error('embedding response has an invalid embedding count')
    }
    embeddingRuntimeHealth = {
      checkedAtMs: now,
      ok: true,
      error: null,
    }
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    embeddingRuntimeHealth = {
      checkedAtMs: now,
      ok: false,
      error: errorMessage,
    }
    recordEvent({
      type: 'model-resource',
      status: 'error',
      message: errorMessage,
      attrs: { category: 'embedding', runtime: 'local-onnx', phase: 'health-check' },
    })
  }

  return {
    ok: embeddingRuntimeHealth.ok,
    error: embeddingRuntimeHealth.error,
  }
}

function buildLexicalEmbeddingVector(text: string): number[] {
  const vector = Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }).fill(0) as number[]
  for (const term of tokenizeMemoryText(text)) {
    const termIndex = stableTermIndex(`term:${term}`)
    vector[termIndex] = (vector[termIndex] ?? 0) + 1
    for (const trigram of termTrigrams(term)) {
      const trigramIndex = stableTermIndex(`tri:${trigram}`)
      vector[trigramIndex] = (vector[trigramIndex] ?? 0) + 0.35
    }
  }
  return normalizeVector(vector)
}

function termTrigrams(term: string): string[] {
  if (term.length <= 3) {
    return [term]
  }
  const trigrams: string[] = []
  for (let index = 0; index <= term.length - 3; index += 1) {
    trigrams.push(term.slice(index, index + 3))
  }
  return trigrams
}

function stableTermIndex(term: string): number {
  const digest = createHash('sha256').update(term).digest()
  return digest.readUInt32BE(0) % MEMORY_EMBEDDING_DIMENSIONS
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) {
    return vector
  }
  return vector.map(value => Number((value / norm).toFixed(6)))
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0
  }
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftNorm += leftValue * leftValue
    rightNorm += rightValue * rightValue
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

function findSnapshotIdsByPaths(paths: string[]): string[] {
  if (paths.length === 0) {
    return []
  }
  const config = syncConfig()
  const normalized = new Set(paths.map(path => toRootRelative(config.storageRoot, path)))
  const rows = db().select().from(chronicleSnapshots).all()
  return rows
    .filter(row => normalized.has(row.artifactPath ?? '') || normalized.has(row.framePath))
    .map(row => row.id)
}

function bpsToRatio(value: number): number {
  return Number((value / 10_000).toFixed(4))
}

function boundedString(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength)
}

function boundedNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function unixSecondsToIso(value: number | null): string | null {
  return value === null ? null : new Date(value * 1000).toISOString()
}

type ChronicleCountTable
  = | 'chronicle_accessibility_events'
    | 'chronicle_accessibility_snapshots'
    | 'chronicle_activity_segments'
    | 'chronicle_activity_sessions'
    | 'chronicle_audio_raw_segments'
    | 'chronicle_audio_transcripts'
    | 'chronicle_dream_runs'
    | 'chronicle_knowledge_cards'
    | 'chronicle_knowledge_versions'
    | 'chronicle_memories'
    | 'chronicle_memory_chunks'
    | 'chronicle_memory_embeddings'
    | 'chronicle_memory_keywords'
    | 'chronicle_messages'
    | 'chronicle_model_resources'
    | 'chronicle_pipeline_runs'
    | 'chronicle_snapshots'

function countTable(tableName: ChronicleCountTable): number {
  return db().get<{ count: number }>(sql.raw(`SELECT COUNT(*) AS count FROM ${tableName}`))?.count ?? 0
}

async function collectDirectoryStats(root: string): Promise<{
  exists: boolean
  fileCount: number
  directoryCount: number
  totalBytes: number
}> {
  try {
    const rootStat = await stat(root)
    if (!rootStat.isDirectory()) {
      return {
        exists: true,
        fileCount: 1,
        directoryCount: 0,
        totalBytes: rootStat.size,
      }
    }
  }
  catch {
    return {
      exists: false,
      fileCount: 0,
      directoryCount: 0,
      totalBytes: 0,
    }
  }

  let fileCount = 0
  let directoryCount = 0
  let totalBytes = 0
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = resolve(root, entry.name)
    if (entry.isDirectory()) {
      directoryCount += 1
      const child = await collectDirectoryStats(entryPath)
      fileCount += child.fileCount
      directoryCount += child.directoryCount
      totalBytes += child.totalBytes
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    const entryStat = await stat(entryPath)
    fileCount += 1
    totalBytes += entryStat.size
  }
  return {
    exists: true,
    fileCount,
    directoryCount,
    totalBytes,
  }
}

function toRootRelative(storageRoot: string, path: string): string {
  const root = resolve(storageRoot)
  const resolved = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const rel = relative(root, resolved)
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel
}

function resolveRelativeJoin(segment: string, frame: string): string {
  return `${segment.replace(/^\/+/, '')}/${frame.replace(/^\/+/, '')}`
}
