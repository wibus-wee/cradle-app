import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  getChronicleConfigOptions,
  getChronicleConfigQueryKey,
  getChronicleMemoriesOptions,
  getChronicleMemoriesQueryKey,
  getChronicleStatusOptions,
  getChronicleStatusQueryKey,
  getChronicleTimelineOptions,
  getChronicleTimelineQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { postSecrets, putChronicleConfig } from '~/api-gen/sdk.gen'
import { getServerUrl } from '~/lib/electron'

export interface ChronicleConfig {
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
  audioSource?: 'microphone' | 'system' | 'mixed'
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
  audioSource?: 'microphone' | 'system' | 'mixed'
  audioRuntimeStatus: 'disabled' | 'armed' | 'unavailable'
  configuredModel: string | null
}

export type ChronicleModelResourceCategory = 'ocr' | 'audio-vad' | 'audio-asr' | 'speaker' | 'embedding' | 'pii'
export type ChronicleModelResourceState = 'available' | 'missing' | 'optional' | 'installing' | 'error'

export interface ChronicleModelResource {
  category: ChronicleModelResourceCategory
  label: string
  state: ChronicleModelResourceState
  required: boolean
  provider: string | null
  path: string | null
  version: string | null
  sizeBytes: number | null
  message: string | null
  metadata: Record<string, unknown> | null
  updatedAt: number | null
}

export interface ChronicleModelResourceInstallDraft {
  category: ChronicleModelResourceCategory
  source?: 'manifest' | 'local-files'
  sourceRoot?: string | null
  files?: Array<{
    relativePath: string
    sourcePath: string
  }>
}

export interface TimelineEntry {
  id: string
  sourceType?: 'snapshot' | 'message' | 'audio'
  capturedAt: string
  capturedAtUnix: number
  displayId: number
  segmentDir: string
  framePath: string
  ocrText: string | null
  appBundleId: string | null
  windowTitle: string | null
  platform?: string | null
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
  matchKind?: 'keyword' | 'semantic' | 'hybrid' | null
  keywordScore?: number | null
  semanticScore?: number | null
  title?: string | null
  sourceCount?: number | null
}

export interface ChronicleAccessibilitySnapshot {
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

export interface ChronicleAccessibilityEvent {
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

export interface ChronicleAudioTranscriptSegment {
  id: string
  segmentIndex: number
  startMs: number
  endMs: number | null
  speakerLabel: string | null
  text: string
  confidence: number | null
  language: string | null
}

export interface ChronicleAudioTranscript {
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
  segments: ChronicleAudioTranscriptSegment[]
}

export interface ChronicleAudioRawSegment {
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
  vadStatus: 'not-implemented' | 'pending' | 'ready' | 'error'
  asrStatus: 'not-implemented' | 'pending' | 'ready' | 'error'
  speakerStatus: 'not-implemented' | 'pending' | 'ready' | 'error'
  metadata: Record<string, unknown>
}

export interface ChronicleSpeakerProfile {
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

export interface ChronicleActivitySegment {
  id: string
  sessionId: string
  startedAt: string
  startedAtUnix: number
  endedAt: string
  endedAtUnix: number
  durationSeconds: number
  segmentType: 'work' | 'meeting' | 'browsing' | 'chat' | 'audio' | 'idle' | 'unknown'
  frontApp: string | null
  title: string | null
  summary: string | null
  sourceCounts: Record<string, number>
  sourceRefs: Record<string, string[]>
  pipelineStatus: 'collecting' | 'triaged' | 'summarized' | 'crystallized' | 'error'
  isCrystallized: boolean
  metadata: Record<string, unknown>
}

export interface ChroniclePipelineRun {
  id: string
  sessionId: string | null
  segmentId: string | null
  trigger: 'snapshot' | 'message' | 'audio-raw' | 'audio-transcript' | 'memory' | 'manual' | 'summarize'
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

export interface ChronicleKnowledgeCard {
  id: string
  title: string
  content: string
  cardType: 'fact' | 'insight' | 'decision' | 'task' | 'pattern'
  dimension: 'technical' | 'business' | 'personal' | 'project' | 'general'
  confidence: number
  sourceMemoryIds: string[]
  sourceSegmentIds: string[]
  sourceChunkIds: string[]
  tags: string[]
  contentHash: string
  version: number
  status: 'active' | 'merged' | 'archived' | 'deleted'
  mergedIntoId: string | null
  pinned: boolean
  metadata: Record<string, unknown>
  createdAt: string
  createdAtUnix: number
  updatedAt: string
  updatedAtUnix: number
}

export interface ChronicleDreamRun {
  id: string
  workspaceId: string | null
  runType: 'archive' | 'merge' | 'prune' | 'restore' | 'dry-run'
  status: 'running' | 'completed' | 'failed'
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
  result: Record<string, unknown> & {
    candidateCount: number
    vectorMode: string
  }
  errorMessage: string | null
}

export interface ChronicleActivityPipelineAction {
  segment: ChronicleActivitySegment
  run: ChroniclePipelineRun
  memoryId: string | null
  knowledgeCards?: ChronicleKnowledgeCard[]
  status: 'success' | 'error' | 'skipped'
  message: string
}

export interface ChronicleActivityPipelineTick {
  checked: number
  triaged: number
  summarized: number
  crystallized: number
  skipped: number
  errors: number
}

export interface ChronicleMessageSource {
  id: string
  platform: 'slack'
  label: string
  enabled: boolean
  workspaceId: string | null
  teamId: string | null
  botTokenRef: string | null
  channelIds: string[]
  realtimeMode: 'polling' | 'events-api' | 'socket-mode'
  signingSecretRef: string | null
  status: 'idle' | 'syncing' | 'ready' | 'error' | 'disabled'
  lastSyncAt: number | null
  lastMessageAt: number | null
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface ChronicleSlackSourceDraft {
  label: string
  token: string
  signingSecret: string
  channelIds: string
  enabled: boolean
  realtimeMode: 'polling' | 'events-api'
}

export interface ChronicleSlackSyncResult {
  sourceId: string
  status: 'success' | 'error'
  ingested: number
  message: string
}

const ChronicleModelResourceCategorySchema = z.enum(['ocr', 'audio-vad', 'audio-asr', 'speaker', 'embedding', 'pii'])

const CHRONICLE_MODEL_RESOURCE_DEFAULTS: ChronicleModelResource[] = [
  {
    category: 'ocr',
    label: 'OCR',
    state: 'available',
    required: true,
    provider: 'macOS Vision',
    path: null,
    version: 'macos-vision',
    sizeBytes: null,
    message: 'Screen text extraction is available through the local macOS runtime.',
    metadata: null,
    updatedAt: null,
  },
  {
    category: 'audio-vad',
    label: 'Audio VAD',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional audio activity detection resource is not installed.',
    metadata: null,
    updatedAt: null,
  },
  {
    category: 'audio-asr',
    label: 'Audio ASR',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional local speech transcription resource is not installed.',
    metadata: null,
    updatedAt: null,
  },
  {
    category: 'speaker',
    label: 'Speaker Extractor',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional speaker embedding extractor resource is not installed.',
    metadata: null,
    updatedAt: null,
  },
  {
    category: 'embedding',
    label: 'Embedding',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional local text embedding resource is not installed.',
    metadata: null,
    updatedAt: null,
  },
  {
    category: 'pii',
    label: 'PII Detection',
    state: 'optional',
    required: false,
    provider: null,
    path: null,
    version: null,
    sizeBytes: null,
    message: 'Optional PII detection model for local entity redaction.',
    metadata: null,
    updatedAt: null,
  },
]

const ChronicleModelResourceEntrySchema = z.object({
  id: z.string(),
  category: ChronicleModelResourceCategorySchema,
  status: z.enum(['available', 'missing', 'installing', 'installed', 'error']),
  displayName: z.string().trim().min(1),
  path: z.string().nullable().optional().default(null),
  version: z.string().nullable().optional().default(null),
  message: z.string().nullable().optional().default(null),
  sizeBytes: z.number().finite().nullable().optional().default(null),
  metadata: z.object({
    provider: z.string().nullable().optional().default(null),
    manifest: z.object({
      required: z.boolean().optional().default(false),
      runtime: z.string().nullable().optional().default(null),
    }).passthrough().optional().default({ required: false, runtime: null }),
  }).passthrough().optional().default({
    provider: null,
    manifest: { required: false, runtime: null },
  }),
  updatedAt: z.number().finite().nullable().optional().default(null),
}).passthrough().transform((entry): ChronicleModelResource => {
  const manifest = entry.metadata.manifest
  const required = entry.category === 'ocr' || manifest.required
  const provider = entry.metadata.provider ?? manifest.runtime

  return {
    category: entry.category,
    label: entry.displayName,
    state: toResourceState(entry.status, required),
    required,
    provider,
    path: entry.path,
    version: entry.version,
    sizeBytes: entry.sizeBytes,
    message: entry.message,
    metadata: entry.metadata,
    updatedAt: entry.updatedAt,
  }
})

const ChronicleModelResourceEntriesSchema = z.array(ChronicleModelResourceEntrySchema)

const ChronicleModelResourcesResponseSchema = ChronicleModelResourceEntriesSchema.transform((entries) => {
  const byCategory = new Map<ChronicleModelResourceCategory, ChronicleModelResource>()
  for (const resource of CHRONICLE_MODEL_RESOURCE_DEFAULTS) {
    byCategory.set(resource.category, resource)
  }

  for (const entry of entries) {
    byCategory.set(entry.category, entry)
  }

  return Array.from(byCategory.values())
})

const ChronicleModelResourceResponseSchema = ChronicleModelResourceEntrySchema

const ChronicleMessageSourceSchema = z.object({
  id: z.string(),
  platform: z.literal('slack'),
  label: z.string(),
  enabled: z.boolean(),
  workspaceId: z.string().nullable().optional().default(null),
  teamId: z.string().nullable().optional().default(null),
  botTokenRef: z.string().nullable().optional().default(null),
  channelIds: z.array(z.string()).optional().default([]),
  realtimeMode: z.enum(['polling', 'events-api', 'socket-mode']),
  signingSecretRef: z.string().nullable().optional().default(null),
  status: z.enum(['idle', 'syncing', 'ready', 'error', 'disabled']),
  lastSyncAt: z.number().finite().nullable().optional().default(null),
  lastMessageAt: z.number().finite().nullable().optional().default(null),
  lastError: z.string().nullable().optional().default(null),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
}).passthrough()

const ChronicleMessageSourcesSchema = z.array(ChronicleMessageSourceSchema)

const ChronicleSlackSyncResultSchema = z.object({
  sourceId: z.string(),
  status: z.enum(['success', 'error']),
  ingested: z.number().finite(),
  message: z.string(),
})

const ChronicleAccessibilitySnapshotSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  snapshotId: z.string().nullable(),
  capturedAt: z.string(),
  capturedAtUnix: z.number().finite(),
  status: z.enum(['ready', 'permission-denied', 'unavailable', 'error']),
  provider: z.string(),
  appBundleId: z.string().nullable(),
  windowTitle: z.string().nullable(),
  elementCount: z.number().finite(),
  text: z.string().nullable(),
  tree: z.array(z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
})

const ChronicleAccessibilitySnapshotsSchema = z.array(ChronicleAccessibilitySnapshotSchema)

const ChronicleAccessibilityEventSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  snapshotId: z.string().nullable(),
  accessibilitySnapshotId: z.string().nullable(),
  capturedAt: z.string(),
  capturedAtUnix: z.number().finite(),
  provider: z.string(),
  appBundleId: z.string().nullable(),
  pid: z.number().finite().nullable(),
  notification: z.string(),
  droppedBefore: z.number().finite(),
  metadata: z.record(z.string(), z.unknown()),
})

const ChronicleAccessibilityEventsSchema = z.array(ChronicleAccessibilityEventSchema)

const ChronicleAudioTranscriptSegmentSchema = z.object({
  id: z.string(),
  segmentIndex: z.number().finite(),
  startMs: z.number().finite(),
  endMs: z.number().finite().nullable(),
  speakerLabel: z.string().nullable(),
  text: z.string(),
  confidence: z.number().finite().nullable(),
  language: z.string().nullable(),
})

const ChronicleAudioTranscriptSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  memoryId: z.string().nullable(),
  title: z.string().nullable(),
  source: z.enum(['asr', 'manual', 'imported']),
  status: z.enum(['recording', 'completed', 'imported', 'error']),
  startedAt: z.string(),
  startedAtUnix: z.number().finite(),
  endedAt: z.string().nullable(),
  endedAtUnix: z.number().finite().nullable(),
  language: z.string().nullable(),
  appBundleId: z.string().nullable(),
  windowTitle: z.string().nullable(),
  segmentCount: z.number().finite(),
  previewText: z.string(),
  segments: z.array(ChronicleAudioTranscriptSegmentSchema),
})

const ChronicleAudioTranscriptsSchema = z.array(ChronicleAudioTranscriptSchema)

const ChronicleAudioRawSegmentSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  recordedAt: z.string(),
  recordedAtUnix: z.number().finite(),
  source: z.enum(['microphone', 'system', 'mixed']),
  status: z.enum(['captured', 'queued', 'processed', 'ignored', 'error']),
  audioPath: z.string(),
  metadataPath: z.string(),
  sampleRate: z.number().finite(),
  channels: z.number().finite(),
  sampleCount: z.number().finite(),
  droppedSamples: z.number().finite(),
  durationMs: z.number().finite(),
  rms: z.number().finite(),
  peak: z.number().finite(),
  active: z.boolean(),
  vadStatus: z.enum(['not-implemented', 'pending', 'ready', 'error']),
  asrStatus: z.enum(['not-implemented', 'pending', 'ready', 'error']),
  speakerStatus: z.enum(['not-implemented', 'pending', 'ready', 'error']),
  metadata: z.record(z.string(), z.unknown()),
})

const ChronicleAudioRawSegmentsSchema = z.array(ChronicleAudioRawSegmentSchema)

const ChronicleSpeakerProfileSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  displayName: z.string(),
  normalizedLabel: z.string(),
  aliases: z.array(z.string()),
  embedding: z.array(z.number()).nullable(),
  embeddingDimensions: z.number().finite().nullable(),
  embeddingModelId: z.string().nullable(),
  sampleCount: z.number().finite(),
  lastSeenAt: z.string().nullable(),
  lastSeenAtUnix: z.number().finite().nullable(),
  sourceTranscriptId: z.string().nullable(),
  sourceSegmentId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  createdAtUnix: z.number().finite(),
  updatedAt: z.string(),
  updatedAtUnix: z.number().finite(),
})

const ChronicleSpeakerProfilesSchema = z.array(ChronicleSpeakerProfileSchema)

const ChronicleActivitySegmentSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  startedAt: z.string(),
  startedAtUnix: z.number().finite(),
  endedAt: z.string(),
  endedAtUnix: z.number().finite(),
  durationSeconds: z.number().finite(),
  segmentType: z.enum(['work', 'meeting', 'browsing', 'chat', 'audio', 'idle', 'unknown']),
  frontApp: z.string().nullable(),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  sourceCounts: z.record(z.string(), z.number()),
  sourceRefs: z.record(z.string(), z.array(z.string())),
  pipelineStatus: z.enum(['collecting', 'triaged', 'summarized', 'crystallized', 'error']),
  isCrystallized: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
})

const ChronicleActivitySegmentsSchema = z.array(ChronicleActivitySegmentSchema)

const ChroniclePipelineRunSchema = z.object({
  id: z.string(),
  sessionId: z.string().nullable(),
  segmentId: z.string().nullable(),
  trigger: z.enum(['snapshot', 'message', 'audio-raw', 'audio-transcript', 'memory', 'manual', 'summarize']),
  stage: z.enum(['collection', 'segmentation', 'triage', 'summarization', 'crystallization']),
  status: z.enum(['queued', 'running', 'success', 'error', 'skipped']),
  startedAt: z.string(),
  startedAtUnix: z.number().finite(),
  endedAt: z.string().nullable(),
  endedAtUnix: z.number().finite().nullable(),
  errorMessage: z.string().nullable(),
  snapshotsCount: z.number().finite(),
  messagesCount: z.number().finite(),
  audioTranscriptsCount: z.number().finite(),
  audioRawSegmentsCount: z.number().finite(),
  memoriesCount: z.number().finite(),
  segmentsCount: z.number().finite(),
  segmentIds: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
})

const ChroniclePipelineRunsSchema = z.array(ChroniclePipelineRunSchema)

const ChronicleKnowledgeCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  cardType: z.enum(['fact', 'insight', 'decision', 'task', 'pattern']),
  dimension: z.enum(['technical', 'business', 'personal', 'project', 'general']),
  confidence: z.number().finite(),
  sourceMemoryIds: z.array(z.string()),
  sourceSegmentIds: z.array(z.string()),
  sourceChunkIds: z.array(z.string()),
  tags: z.array(z.string()),
  contentHash: z.string(),
  version: z.number().finite(),
  status: z.enum(['active', 'merged', 'archived', 'deleted']),
  mergedIntoId: z.string().nullable(),
  pinned: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  createdAtUnix: z.number().finite(),
  updatedAt: z.string(),
  updatedAtUnix: z.number().finite(),
})

const ChronicleKnowledgeCardsSchema = z.array(ChronicleKnowledgeCardSchema)

const ChronicleDreamRunResultSchema = z.record(z.string(), z.unknown()).pipe(z.object({
  candidateCount: z.number().finite().optional(),
  vectorMode: z.string().min(1).default('chronicle-lexical/v1'),
}).passthrough())

const ChronicleDreamRunSchema = z.object({
  id: z.string(),
  workspaceId: z.string().nullable(),
  runType: z.enum(['archive', 'merge', 'prune', 'restore', 'dry-run']),
  status: z.enum(['running', 'completed', 'failed']),
  startedAt: z.string(),
  startedAtUnix: z.number().finite(),
  endedAt: z.string().nullable(),
  endedAtUnix: z.number().finite().nullable(),
  inputCount: z.number().finite(),
  outputCount: z.number().finite(),
  mergedCount: z.number().finite(),
  deletedCount: z.number().finite(),
  sourceKnowledgeIds: z.array(z.string()),
  outputKnowledgeIds: z.array(z.string()),
  config: z.record(z.string(), z.unknown()),
  result: ChronicleDreamRunResultSchema,
  errorMessage: z.string().nullable(),
}).transform(run => ({
  ...run,
  result: {
    ...run.result,
    candidateCount: run.result.candidateCount ?? run.outputCount,
  },
}))

const ChronicleDreamRunsSchema = z.array(ChronicleDreamRunSchema)

const ChronicleActivityPipelineActionSchema = z.object({
  segment: ChronicleActivitySegmentSchema,
  run: ChroniclePipelineRunSchema,
  memoryId: z.string().nullable(),
  knowledgeCards: z.array(ChronicleKnowledgeCardSchema).optional(),
  status: z.enum(['success', 'error', 'skipped']),
  message: z.string(),
})

const ChronicleActivityPipelineTickSchema = z.object({
  checked: z.number().finite(),
  triaged: z.number().finite(),
  summarized: z.number().finite(),
  crystallized: z.number().finite(),
  skipped: z.number().finite(),
  errors: z.number().finite(),
})

const MemoryEntrySchema = z.object({
  id: z.string(),
  type: z.enum(['10min', '6h']),
  source: z.enum(['llm', 'local', 'imported']),
  createdAt: z.string(),
  createdAtUnix: z.number().finite(),
  content: z.string(),
  modelId: z.string().nullable(),
  matchKind: z.enum(['keyword', 'semantic', 'hybrid']).nullable().optional(),
  keywordScore: z.number().finite().nullable().optional(),
  semanticScore: z.number().finite().nullable().optional(),
  title: z.string().nullable().optional(),
  sourceCount: z.number().finite().nullable().optional(),
})

const ChronicleConfigSchema = z.object({
  profileId: z.string(),
  modelId: z.string(),
  workspaceId: z.string(),
  enabled: z.boolean(),
  activityPipelineEnabled: z.boolean(),
  activityPipelineIntervalMs: z.number().finite(),
  activityPipelineBatchSize: z.number().finite(),
  dreamSchedulerEnabled: z.boolean(),
  dreamSchedulerIntervalMs: z.number().finite(),
  dreamSchedulerApplyMerge: z.boolean(),
  audioCaptureEnabled: z.boolean(),
  audioSource: z.enum(['microphone', 'system', 'mixed']).optional(),
  audioSegmentMs: z.number().finite(),
  audioSegmentIntervalMs: z.number().finite(),
  audioRmsThreshold: z.number().finite(),
  storageRoot: z.string(),
  privacySensitiveAppBundleIds: z.array(z.string()).default([]),
  privacySensitiveTitlePatterns: z.array(z.string()).default([]),
  privacySensitiveUrlPatterns: z.array(z.string()).default([]),
  closedEyesDiscardEnabled: z.boolean().default(false),
  closedEyesMode: z.enum(['auto', 'always-record', 'always-pause']).default('auto'),
})

const ChronicleStatusSchema = z.object({
  available: z.boolean(),
  running: z.boolean(),
  pid: z.number().finite().nullable(),
  lastCaptureAt: z.number().finite().nullable(),
  lastSummaryAt: z.number().finite().nullable(),
  lastErrorAt: z.number().finite().nullable(),
  lastError: z.string().nullable(),
  lastExitCode: z.number().finite().nullable(),
  lastExitAt: z.number().finite().nullable(),
  totalSnapshots: z.number().finite(),
  totalSummaries: z.number().finite(),
  totalMessages: z.number().finite(),
  lastMessageAt: z.number().finite().nullable(),
  totalAccessibilitySnapshots: z.number().finite(),
  lastAccessibilitySnapshotAt: z.number().finite().nullable(),
  totalAccessibilityEvents: z.number().finite(),
  lastAccessibilityEventAt: z.number().finite().nullable(),
  totalAudioTranscripts: z.number().finite(),
  lastAudioTranscriptAt: z.number().finite().nullable(),
  totalAudioRawSegments: z.number().finite(),
  lastAudioRawSegmentAt: z.number().finite().nullable(),
  totalActivitySegments: z.number().finite(),
  lastActivitySegmentAt: z.number().finite().nullable(),
  totalPipelineRuns: z.number().finite(),
  lastPipelineRunAt: z.number().finite().nullable(),
  totalKnowledgeCards: z.number().finite(),
  lastKnowledgeCardAt: z.number().finite().nullable(),
  totalDreamRuns: z.number().finite(),
  lastDreamRunAt: z.number().finite().nullable(),
  dreamSchedulerEnabled: z.boolean(),
  dreamSchedulerRunning: z.boolean(),
  dreamSchedulerIntervalMs: z.number().finite(),
  dreamSchedulerApplyMerge: z.boolean(),
  activityPipelineEnabled: z.boolean(),
  activityPipelineRunning: z.boolean(),
  activityPipelineIntervalMs: z.number().finite(),
  activityPipelineBatchSize: z.number().finite(),
  audioCaptureEnabled: z.boolean(),
  audioSource: z.enum(['microphone', 'system', 'mixed']).optional(),
  audioRuntimeStatus: z.enum(['disabled', 'armed', 'unavailable']),
  configuredModel: z.string().nullable(),
})

const TimelineEntrySchema = z.object({
  id: z.string(),
  sourceType: z.enum(['snapshot', 'message', 'audio']).optional(),
  capturedAt: z.string(),
  capturedAtUnix: z.number().finite(),
  displayId: z.number().finite(),
  segmentDir: z.string(),
  framePath: z.string(),
  ocrText: z.string().nullable(),
  appBundleId: z.string().nullable(),
  windowTitle: z.string().nullable(),
  platform: z.string().nullable().optional(),
  channelId: z.string().nullable().optional(),
  channelName: z.string().nullable().optional(),
  userName: z.string().nullable().optional(),
})

const TimelineEntriesSchema = z.array(TimelineEntrySchema)
const MemoryEntriesSchema = z.array(MemoryEntrySchema)

const ChronicleModelResourceInstallDraftSchema = z.object({
  category: ChronicleModelResourceCategorySchema,
  source: z.enum(['manifest', 'local-files']).optional(),
  sourceRoot: z.string().trim().min(1).nullable().optional(),
  files: z.array(z.object({
    relativePath: z.string(),
    sourcePath: z.string(),
  })).default([]),
}).transform(draft => ({
  category: draft.category,
  body: {
    source: draft.source ?? (draft.files.length > 0 || draft.sourceRoot ? 'local-files' : 'manifest'),
    sourceRoot: draft.sourceRoot ?? null,
    files: draft.files,
  },
}))

const SecretResponseSchema = z.object({
  id: z.string().min(1),
}).passthrough()

function toResourceState(
  status: 'available' | 'missing' | 'installing' | 'installed' | 'error',
  required: boolean,
): ChronicleModelResourceState {
  if (status === 'installing') {
    return 'installing'
  }
  if (status === 'error') {
    return 'error'
  }
  if (status === 'missing') {
    return required ? 'missing' : 'optional'
  }
  return 'available'
}

async function requestChronicleJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${getServerUrl()}${path}`, init)
  if (!response.ok) {
    throw new Error(`Chronicle request failed: ${response.status}`)
  }
  return response.json()
}

export const CHRONICLE_CONFIG_QUERY_KEY = getChronicleConfigQueryKey()
const CHRONICLE_STATUS_QUERY_KEY = getChronicleStatusQueryKey()
const CHRONICLE_MODEL_RESOURCES_QUERY_KEY = ['chronicle', 'model-resources'] as const
const CHRONICLE_MESSAGE_SOURCES_QUERY_KEY = ['chronicle', 'message-sources'] as const
const CHRONICLE_ACCESSIBILITY_SNAPSHOTS_QUERY_KEY = ['chronicle', 'accessibility-snapshots'] as const
const CHRONICLE_ACCESSIBILITY_EVENTS_QUERY_KEY = ['chronicle', 'accessibility-events'] as const
const CHRONICLE_AUDIO_TRANSCRIPTS_QUERY_KEY = ['chronicle', 'audio-transcripts'] as const
const CHRONICLE_AUDIO_RAW_SEGMENTS_QUERY_KEY = ['chronicle', 'audio-raw-segments'] as const
const CHRONICLE_SPEAKER_PROFILES_QUERY_KEY = ['chronicle', 'speaker-profiles'] as const
const CHRONICLE_ACTIVITY_SEGMENTS_QUERY_KEY = ['chronicle', 'activity-segments'] as const
const CHRONICLE_PIPELINE_RUNS_QUERY_KEY = ['chronicle', 'pipeline-runs'] as const
const CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY = ['chronicle', 'knowledge-cards'] as const
const CHRONICLE_DREAM_RUNS_QUERY_KEY = ['chronicle', 'dream-runs'] as const
const CHRONICLE_TIMELINE_QUERY_KEY = getChronicleTimelineQueryKey()
const CHRONICLE_MEMORIES_QUERY_KEY = getChronicleMemoriesQueryKey()
const CHANNEL_ID_SPLIT_RE = /[\s,]+/

export function useChronicleConfig() {
  const queryClient = useQueryClient()

  const { data: config = null, isLoading: loading } = useQuery({
    ...getChronicleConfigOptions(),
    select: data => ChronicleConfigSchema.parse(data),
  })

  const { mutateAsync: updateConfig, isPending: saving } = useMutation<
    ChronicleConfig | null,
    Error,
    Partial<ChronicleConfig>
  >({
    scope: { id: 'chronicle-config' },
    mutationFn: async (updates) => {
      const current = queryClient.getQueryData<ChronicleConfig>(CHRONICLE_CONFIG_QUERY_KEY)
      if (!current) {
        return null
      }
      const next = { ...current, ...updates }
      const { data } = await putChronicleConfig({
        body: next,
      })
      return ChronicleConfigSchema.parse(data)
    },
    onSuccess: (updated) => {
      if (updated) {
        queryClient.setQueryData(CHRONICLE_CONFIG_QUERY_KEY, updated)
      }
      void queryClient.invalidateQueries({ queryKey: getChronicleStatusQueryKey() })
      void queryClient.invalidateQueries({ queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY })
    },
  })

  return { config, loading, saving, updateConfig }
}

export function useChronicleStatus() {
  const { data: status = null, isLoading: loading, refetch } = useQuery({
    ...getChronicleStatusOptions(),
    select: data => ChronicleStatusSchema.parse(data),
    refetchInterval: 5_000,
  })

  return { status, loading, refetch }
}

export function useChronicleModelResources() {
  const { data: resources = CHRONICLE_MODEL_RESOURCE_DEFAULTS, isLoading: loading, refetch } = useQuery({
    queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY,
    queryFn: async () =>
      ChronicleModelResourcesResponseSchema.parse(await requestChronicleJson('/chronicle/model-resources')),
    refetchInterval: 10_000,
  })

  return { resources, loading, refetch }
}

export function useChronicleModelResourceActions() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: getChronicleStatusQueryKey() })
  }

  const { mutateAsync: reconcileResources, isPending: reconciling } = useMutation({
    mutationFn: async () => {
      return ChronicleModelResourcesResponseSchema.parse(await requestChronicleJson('/chronicle/model-resources/reconcile', {
        method: 'POST',
      }))
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: installAllResources, isPending: installingAll } = useMutation({
    mutationFn: async () => {
      return ChronicleModelResourcesResponseSchema.parse(await requestChronicleJson('/chronicle/model-resources/install-all', {
        method: 'POST',
      }))
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: verifyResource, isPending: verifying } = useMutation({
    mutationFn: async (category: ChronicleModelResourceCategory) => {
      return ChronicleModelResourceResponseSchema.parse(await requestChronicleJson(
        `/chronicle/model-resources/${encodeURIComponent(category)}/verify`,
        { method: 'POST' },
      ))
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: installResource, isPending: installing } = useMutation({
    mutationFn: async (draft: ChronicleModelResourceInstallDraft) => {
      const installDraft = ChronicleModelResourceInstallDraftSchema.parse(draft)
      return ChronicleModelResourceResponseSchema.parse(await requestChronicleJson(
        `/chronicle/model-resources/${encodeURIComponent(installDraft.category)}/install`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(installDraft.body),
        },
      ))
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: removeResource, isPending: removing } = useMutation({
    mutationFn: async (category: ChronicleModelResourceCategory) => {
      return ChronicleModelResourceResponseSchema.parse(await requestChronicleJson(
        `/chronicle/model-resources/${encodeURIComponent(category)}`,
        { method: 'DELETE' },
      ))
    },
    onSuccess: invalidate,
  })

  return {
    reconcileResources,
    installAllResources,
    verifyResource,
    installResource,
    removeResource,
    reconciling,
    installingAll,
    verifying,
    installing,
    removing,
  }
}

export function useChronicleMessageSources() {
  const { data: sources = [], isLoading: loading, refetch } = useQuery({
    queryKey: CHRONICLE_MESSAGE_SOURCES_QUERY_KEY,
    queryFn: async () =>
      ChronicleMessageSourcesSchema.parse(await requestChronicleJson('/chronicle/message-sources')),
    refetchInterval: 10_000,
  })

  return { sources, loading, refetch }
}

export function useChronicleSlackSourceActions() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MESSAGE_SOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: getChronicleStatusQueryKey() })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_TIMELINE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MEMORIES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['chronicle', 'memories', 'search'] })
  }

  const { mutateAsync: saveSource, isPending: saving } = useMutation({
    mutationFn: async (draft: ChronicleSlackSourceDraft) => {
      const channelIds = draft.channelIds
        .split(CHANNEL_ID_SPLIT_RE)
        .map(channelId => channelId.trim())
        .filter(Boolean)
      const { data: tokenSecret } = await postSecrets({
        body: {
          kind: 'chronicle.slack.bot-token',
          label: draft.label,
          secret: draft.token,
        },
      })
      const botTokenRef = SecretResponseSchema.parse(tokenSecret).id

      let signingSecretRef: string | null = null
      if (draft.realtimeMode === 'events-api') {
        const signingSecretValue = draft.signingSecret.trim()
        if (!signingSecretValue) {
          throw new Error('Slack signing secret is required for Events API')
        }
        const { data: signingSecret } = await postSecrets({
          body: {
            kind: 'chronicle.slack.signing-secret',
            label: `${draft.label} signing secret`,
            secret: signingSecretValue,
          },
        })
        signingSecretRef = SecretResponseSchema.parse(signingSecret).id
      }
      return ChronicleMessageSourceSchema.parse(await requestChronicleJson('/chronicle/message-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform: 'slack',
          label: draft.label,
          enabled: draft.enabled,
          botTokenRef,
          channelIds,
          realtimeMode: draft.realtimeMode,
          signingSecretRef,
        }),
      }))
    },
    onSuccess: invalidate,
  })

  const { mutateAsync: syncSource, isPending: syncing } = useMutation({
    mutationFn: async (sourceId: string) => {
      return ChronicleSlackSyncResultSchema.parse(await requestChronicleJson(
        `/chronicle/message-sources/${encodeURIComponent(sourceId)}/sync`,
        { method: 'POST' },
      ))
    },
    onSuccess: invalidate,
  })

  return { saveSource, syncSource, saving, syncing }
}

export function useChronicleAccessibilitySnapshots(limit = 20) {
  const { data: snapshots = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_ACCESSIBILITY_SNAPSHOTS_QUERY_KEY, limit],
    queryFn: async () => ChronicleAccessibilitySnapshotsSchema.parse(await requestChronicleJson(
      `/chronicle/accessibility-snapshots?limit=${limit}`,
    )),
    refetchInterval: 10_000,
  })

  return { snapshots, loading, refetch }
}

export function useChronicleAccessibilityEvents(limit = 50) {
  const { data: events = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_ACCESSIBILITY_EVENTS_QUERY_KEY, limit],
    queryFn: async () => ChronicleAccessibilityEventsSchema.parse(await requestChronicleJson(
      `/chronicle/accessibility-events?limit=${limit}`,
    )),
    refetchInterval: 10_000,
  })

  return { events, loading, refetch }
}

export function useChronicleAudioTranscripts(limit = 20) {
  const { data: transcripts = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_AUDIO_TRANSCRIPTS_QUERY_KEY, limit],
    queryFn: async () => ChronicleAudioTranscriptsSchema.parse(await requestChronicleJson(
      `/chronicle/audio-transcripts?limit=${limit}`,
    )),
    refetchInterval: 10_000,
  })

  return { transcripts, loading, refetch }
}

export function useChronicleAudioRawSegments(limit = 20) {
  const { data: segments = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_AUDIO_RAW_SEGMENTS_QUERY_KEY, limit],
    queryFn: async () => ChronicleAudioRawSegmentsSchema.parse(await requestChronicleJson(
      `/chronicle/audio-raw-segments?limit=${limit}`,
    )),
    refetchInterval: 10_000,
  })

  return { segments, loading, refetch }
}

export function useChronicleSpeakerProfiles() {
  const { data: profiles = [], isLoading: loading, refetch } = useQuery({
    queryKey: CHRONICLE_SPEAKER_PROFILES_QUERY_KEY,
    queryFn: async () =>
      ChronicleSpeakerProfilesSchema.parse(await requestChronicleJson('/chronicle/speaker-profiles')),
    refetchInterval: 10_000,
  })

  return { profiles, loading, refetch }
}

export function useChronicleActivitySegments(limit = 20) {
  const { data: segments = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_ACTIVITY_SEGMENTS_QUERY_KEY, limit],
    queryFn: async () => ChronicleActivitySegmentsSchema.parse(await requestChronicleJson(
      `/chronicle/activity-segments?limit=${limit}`,
    )),
    refetchInterval: 10_000,
  })

  return { segments, loading, refetch }
}

export function useChroniclePipelineRuns(limit = 20) {
  const { data: runs = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_PIPELINE_RUNS_QUERY_KEY, limit],
    queryFn: async () => ChroniclePipelineRunsSchema.parse(await requestChronicleJson(
      `/chronicle/pipeline-runs?limit=${limit}`,
    )),
    refetchInterval: 10_000,
  })

  return { runs, loading, refetch }
}

export function useChronicleKnowledgeCards(limit = 20) {
  const { data: cards = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY, limit],
    queryFn: async () => ChronicleKnowledgeCardsSchema.parse(await requestChronicleJson(
      `/chronicle/knowledge-cards?limit=${limit}`,
    )),
    refetchInterval: 10_000,
  })

  return { cards, loading, refetch }
}

export function useChronicleKnowledgeCard(cardId: string | null) {
  const { data: card = null, isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY, 'detail', cardId],
    queryFn: async () => ChronicleKnowledgeCardSchema.parse(await requestChronicleJson(
      `/chronicle/knowledge-cards/${encodeURIComponent(cardId!)}`,
    )),
    enabled: Boolean(cardId),
  })

  return { card, loading, refetch }
}

export function useChronicleDreamRuns(limit = 20) {
  const { data: runs = [], isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_DREAM_RUNS_QUERY_KEY, limit],
    queryFn: async () => ChronicleDreamRunsSchema.parse(await requestChronicleJson(
      `/chronicle/dream-runs?limit=${limit}`,
    )),
    refetchInterval: 10_000,
  })

  return { runs, loading, refetch }
}

export function useChronicleDreamActions() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_DREAM_RUNS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_STATUS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MEMORIES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['chronicle', 'memories', 'search'] })
  }

  const { mutateAsync: startDreamDryRun, isPending: startingDryRun } = useMutation({
    mutationFn: async () => ChronicleDreamRunSchema.parse(await requestChronicleJson('/chronicle/dream-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: true, runType: 'dry-run' }),
    })),
    onSuccess: invalidate,
  })

  const { mutateAsync: startDreamMerge, isPending: startingMerge } = useMutation({
    mutationFn: async () => ChronicleDreamRunSchema.parse(await requestChronicleJson('/chronicle/dream-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: false, runType: 'merge', applyMerge: true }),
    })),
    onSuccess: invalidate,
  })

  return { startDreamDryRun, startDreamMerge, startingDryRun, startingMerge }
}

export function useChronicleActivityPipelineActions() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_ACTIVITY_SEGMENTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_PIPELINE_RUNS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MEMORIES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_STATUS_QUERY_KEY })
  }

  const { mutateAsync: triageSegment, isPending: triaging } = useMutation({
    mutationFn: async (segmentId: string) => ChronicleActivityPipelineActionSchema.parse(await requestChronicleJson(
      `/chronicle/activity-segments/${encodeURIComponent(segmentId)}/triage`,
      { method: 'POST' },
    )),
    onSuccess: invalidate,
  })

  const { mutateAsync: summarizeSegment, isPending: summarizing } = useMutation({
    mutationFn: async (segmentId: string) => ChronicleActivityPipelineActionSchema.parse(await requestChronicleJson(
      `/chronicle/activity-segments/${encodeURIComponent(segmentId)}/summarize`,
      { method: 'POST' },
    )),
    onSuccess: invalidate,
  })

  const { mutateAsync: crystallizeSegment, isPending: crystallizing } = useMutation({
    mutationFn: async (segmentId: string) => ChronicleActivityPipelineActionSchema.parse(await requestChronicleJson(
      `/chronicle/activity-segments/${encodeURIComponent(segmentId)}/crystallize`,
      { method: 'POST' },
    )),
    onSuccess: invalidate,
  })

  const { mutateAsync: runPipelineTick, isPending: ticking } = useMutation({
    mutationFn: async () => ChronicleActivityPipelineTickSchema.parse(await requestChronicleJson(
      '/chronicle/activity-pipeline/tick',
      { method: 'POST' },
    )),
    onSuccess: invalidate,
  })

  return {
    triageSegment,
    summarizeSegment,
    crystallizeSegment,
    runPipelineTick,
    triaging,
    summarizing,
    crystallizing,
    ticking,
  }
}

export function useChronicleTimeline(limit = 50) {
  const { data: entries = [], isLoading: loading, refetch } = useQuery({
    ...getChronicleTimelineOptions({ query: { limit } }),
    select: data => TimelineEntriesSchema.parse(data),
    refetchInterval: 10_000,
  })

  return { entries, loading, refetch }
}

export function useChronicleMemories(limit = 20) {
  const { data: entries = [], isLoading: loading, refetch } = useQuery({
    ...getChronicleMemoriesOptions({ query: { limit } }),
    select: data => MemoryEntriesSchema.parse(data),
    refetchInterval: 15_000,
  })

  return { entries, loading, refetch }
}

export function useChronicleMemory(memoryId: string | null) {
  const { data: entry = null, isLoading: loading, refetch } = useQuery({
    queryKey: [...CHRONICLE_MEMORIES_QUERY_KEY, 'detail', memoryId],
    queryFn: async () => MemoryEntrySchema.parse(await requestChronicleJson(
      `/chronicle/memories/${encodeURIComponent(memoryId!)}`,
    )),
    enabled: Boolean(memoryId),
  })

  return { entry, loading, refetch }
}

export function useChronicleMemorySearch(query: string, limit = 20) {
  const normalizedQuery = query.trim()

  const { data: entries = [], isLoading: loading, isFetching, refetch } = useQuery({
    queryKey: ['chronicle', 'memories', 'search', normalizedQuery, limit],
    queryFn: async () => MemoryEntriesSchema.parse(await requestChronicleJson(
      `/chronicle/memories/search?q=${encodeURIComponent(normalizedQuery)}&limit=${limit}`,
    )),
    enabled: normalizedQuery.length > 0,
  })

  return {
    entries,
    loading,
    searching: isFetching,
    hasQuery: normalizedQuery.length > 0,
    refetch,
  }
}

export function useRefreshChronicleQueries() {
  const queryClient = useQueryClient()

  return () => {
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_CONFIG_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_STATUS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MODEL_RESOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MESSAGE_SOURCES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_ACCESSIBILITY_SNAPSHOTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_ACCESSIBILITY_EVENTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_AUDIO_TRANSCRIPTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_AUDIO_RAW_SEGMENTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_SPEAKER_PROFILES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_ACTIVITY_SEGMENTS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_PIPELINE_RUNS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_KNOWLEDGE_CARDS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_DREAM_RUNS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_TIMELINE_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: CHRONICLE_MEMORIES_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ['chronicle', 'memories', 'search'] })
  }
}
