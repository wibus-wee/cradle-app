import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps, workspaces } from './shared'

export const chronicleSnapshots = sqliteTable('chronicle_snapshots', {
  id: textPk(),
  sourceId: text('source_id').notNull(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  capturedAt: int('captured_at').notNull(),
  displayId: int('display_id').notNull().default(0),
  segmentDir: text('segment_dir').notNull().default(''),
  framePath: text('frame_path').notNull().default(''),
  artifactPath: text('artifact_path'),
  ocrText: text('ocr_text'),
  appBundleId: text('app_bundle_id'),
  windowTitle: text('window_title'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  bySourceId: uniqueIndex('chronicle_snapshots_source_id_unique').on(table.sourceId),
  byCapturedAt: index('chronicle_snapshots_captured_at_idx').on(table.capturedAt),
  byWorkspaceCapturedAt: index('chronicle_snapshots_workspace_captured_at_idx').on(table.workspaceId, table.capturedAt),
}))

export const chronicleAccessibilitySnapshots = sqliteTable('chronicle_accessibility_snapshots', {
  id: textPk(),
  sourceId: text('source_id').notNull(),
  snapshotId: text('snapshot_id')
    .references(() => chronicleSnapshots.id, { onDelete: 'set null' }),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  capturedAt: int('captured_at').notNull(),
  status: text('status', {
    enum: ['ready', 'permission-denied', 'unavailable', 'error'],
  }).notNull().default('ready'),
  provider: text('provider').notNull().default('macos-accessibility'),
  appBundleId: text('app_bundle_id'),
  windowTitle: text('window_title'),
  elementCount: int('element_count').notNull().default(0),
  text: text('text'),
  treeJson: text('tree_json').notNull().default('[]'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  bySourceId: uniqueIndex('chronicle_accessibility_snapshots_source_id_unique').on(table.sourceId),
  bySnapshot: index('chronicle_accessibility_snapshots_snapshot_id_idx').on(table.snapshotId),
  byCapturedAt: index('chronicle_accessibility_snapshots_captured_at_idx').on(table.capturedAt),
  byWorkspaceCapturedAt: index('chronicle_accessibility_snapshots_workspace_captured_at_idx').on(table.workspaceId, table.capturedAt),
  byStatus: index('chronicle_accessibility_snapshots_status_idx').on(table.status),
}))

export const chronicleAccessibilityEvents = sqliteTable('chronicle_accessibility_events', {
  id: textPk(),
  sourceId: text('source_id').notNull(),
  snapshotId: text('snapshot_id')
    .references(() => chronicleSnapshots.id, { onDelete: 'set null' }),
  accessibilitySnapshotId: text('accessibility_snapshot_id')
    .references(() => chronicleAccessibilitySnapshots.id, { onDelete: 'set null' }),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  capturedAt: int('captured_at').notNull(),
  provider: text('provider').notNull().default('macos-ax-observer'),
  appBundleId: text('app_bundle_id'),
  pid: int('pid'),
  notification: text('notification').notNull(),
  droppedBefore: int('dropped_before').notNull().default(0),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  bySourceId: uniqueIndex('chronicle_accessibility_events_source_id_unique').on(table.sourceId),
  byCapturedAt: index('chronicle_accessibility_events_captured_at_idx').on(table.capturedAt),
  byWorkspaceCapturedAt: index('chronicle_accessibility_events_workspace_captured_at_idx').on(table.workspaceId, table.capturedAt),
  byNotification: index('chronicle_accessibility_events_notification_idx').on(table.notification),
  bySnapshot: index('chronicle_accessibility_events_snapshot_id_idx').on(table.snapshotId),
  byAccessibilitySnapshot: index('chronicle_accessibility_events_accessibility_snapshot_id_idx').on(table.accessibilitySnapshotId),
}))

export const chronicleActivitySessions = sqliteTable('chronicle_activity_sessions', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  startedAt: int('started_at').notNull(),
  endedAt: int('ended_at'),
  frontApp: text('front_app'),
  title: text('title'),
  segmentCount: int('segment_count').notNull().default(0),
  snapshotCount: int('snapshot_count').notNull().default(0),
  messageCount: int('message_count').notNull().default(0),
  audioTranscriptCount: int('audio_transcript_count').notNull().default(0),
  audioRawSegmentCount: int('audio_raw_segment_count').notNull().default(0),
  accessibilitySnapshotCount: int('accessibility_snapshot_count').notNull().default(0),
  durationSeconds: int('duration_seconds'),
  isMeeting: int('is_meeting', { mode: 'boolean' }).notNull().default(false),
  meetingTitle: text('meeting_title'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byStartedAt: index('chronicle_activity_sessions_started_at_idx').on(table.startedAt),
  byWorkspaceStartedAt: index('chronicle_activity_sessions_workspace_started_at_idx').on(table.workspaceId, table.startedAt),
  byMeeting: index('chronicle_activity_sessions_meeting_idx').on(table.isMeeting),
}))

export const chronicleActivitySegments = sqliteTable('chronicle_activity_segments', {
  id: textPk(),
  sessionId: text('session_id')
    .notNull()
    .references(() => chronicleActivitySessions.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  startSnapshotId: text('start_snapshot_id')
    .references(() => chronicleSnapshots.id, { onDelete: 'set null' }),
  endSnapshotId: text('end_snapshot_id')
    .references(() => chronicleSnapshots.id, { onDelete: 'set null' }),
  startedAt: int('started_at').notNull(),
  endedAt: int('ended_at').notNull(),
  segmentType: text('segment_type', {
    enum: ['work', 'meeting', 'browsing', 'chat', 'audio', 'idle', 'unknown'],
  }).notNull().default('unknown'),
  frontApp: text('front_app'),
  title: text('title'),
  summary: text('summary'),
  sourceCountsJson: text('source_counts_json').notNull().default('{}'),
  sourceRefsJson: text('source_refs_json').notNull().default('{}'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  pipelineStatus: text('pipeline_status', {
    enum: ['collecting', 'triaged', 'summarized', 'crystallized', 'error'],
  }).notNull().default('collecting'),
  isCrystallized: int('is_crystallized', { mode: 'boolean' }).notNull().default(false),
  ...timestamps(),
}, table => ({
  bySession: index('chronicle_activity_segments_session_id_idx').on(table.sessionId),
  byWorkspaceStartedAt: index('chronicle_activity_segments_workspace_started_at_idx').on(table.workspaceId, table.startedAt),
  byStartedAt: index('chronicle_activity_segments_started_at_idx').on(table.startedAt),
  byType: index('chronicle_activity_segments_type_idx').on(table.segmentType),
  byPipelineStatus: index('chronicle_activity_segments_pipeline_status_idx').on(table.pipelineStatus),
  byCrystallized: index('chronicle_activity_segments_crystallized_idx').on(table.isCrystallized),
}))

export const chronicleMemories = sqliteTable('chronicle_memories', {
  id: textPk(),
  sourceId: text('source_id').notNull(),
  contentHash: text('content_hash'),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  type: text('type', { enum: ['10min', '6h'] }).notNull(),
  source: text('source', { enum: ['llm', 'local', 'imported'] }).notNull().default('llm'),
  content: text('content').notNull(),
  prompt: text('prompt'),
  sourceSnapshotIdsJson: text('source_snapshot_ids_json').notNull().default('[]'),
  sourcePathsJson: text('source_paths_json').notNull().default('[]'),
  modelProfileId: text('model_profile_id'),
  modelId: text('model_id'),
  usageJson: text('usage_json').notNull().default('{}'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: int('created_at').notNull(),
  updatedAt: int('updated_at').notNull(),
}, table => ({
  bySourceId: uniqueIndex('chronicle_memories_source_id_unique').on(table.sourceId),
  byContentHash: index('chronicle_memories_content_hash_idx').on(table.contentHash),
  byCreatedAt: index('chronicle_memories_created_at_idx').on(table.createdAt),
  byWorkspaceCreatedAt: index('chronicle_memories_workspace_created_at_idx').on(table.workspaceId, table.createdAt),
  byTypeCreatedAt: index('chronicle_memories_type_created_at_idx').on(table.type, table.createdAt),
}))

export const chronicleMemoryChunks = sqliteTable('chronicle_memory_chunks', {
  id: textPk(),
  memoryId: text('memory_id')
    .notNull()
    .references(() => chronicleMemories.id, { onDelete: 'cascade' }),
  chunkIndex: int('chunk_index').notNull(),
  content: text('content').notNull(),
  contentHash: text('content_hash').notNull(),
  tokenCount: int('token_count').notNull().default(0),
  embeddingStatus: text('embedding_status', {
    enum: ['missing', 'pending', 'ready', 'error'],
  }).notNull().default('missing'),
  embeddingModelId: text('embedding_model_id'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byMemoryChunk: uniqueIndex('chronicle_memory_chunks_memory_chunk_unique').on(table.memoryId, table.chunkIndex),
  byMemory: index('chronicle_memory_chunks_memory_id_idx').on(table.memoryId),
  byContentHash: index('chronicle_memory_chunks_content_hash_idx').on(table.contentHash),
  byEmbeddingStatus: index('chronicle_memory_chunks_embedding_status_idx').on(table.embeddingStatus),
}))

export const chronicleMemoryKeywords = sqliteTable('chronicle_memory_keywords', {
  id: textPk(),
  memoryId: text('memory_id')
    .notNull()
    .references(() => chronicleMemories.id, { onDelete: 'cascade' }),
  chunkId: text('chunk_id')
    .notNull()
    .references(() => chronicleMemoryChunks.id, { onDelete: 'cascade' }),
  term: text('term').notNull(),
  source: text('source', { enum: ['content', 'prompt', 'metadata'] }).notNull(),
  occurrences: int('occurrences').notNull().default(1),
  weight: int('weight').notNull().default(1),
  createdAt: int('created_at').notNull(),
}, table => ({
  byMemoryChunkTermSource: uniqueIndex('chronicle_memory_keywords_memory_chunk_term_source_unique').on(table.memoryId, table.chunkId, table.term, table.source),
  byTerm: index('chronicle_memory_keywords_term_idx').on(table.term),
  byMemory: index('chronicle_memory_keywords_memory_id_idx').on(table.memoryId),
  bySourceTerm: index('chronicle_memory_keywords_source_term_idx').on(table.source, table.term),
}))

export const chronicleMemoryEmbeddings = sqliteTable('chronicle_memory_embeddings', {
  id: textPk(),
  memoryId: text('memory_id')
    .notNull()
    .references(() => chronicleMemories.id, { onDelete: 'cascade' }),
  chunkId: text('chunk_id')
    .notNull()
    .references(() => chronicleMemoryChunks.id, { onDelete: 'cascade' }),
  modelId: text('model_id').notNull(),
  modelVersion: text('model_version').notNull(),
  dimensions: int('dimensions').notNull(),
  vectorJson: text('vector_json').notNull(),
  vectorHash: text('vector_hash').notNull(),
  status: text('status', { enum: ['ready', 'error'] }).notNull().default('ready'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byChunkModel: uniqueIndex('chronicle_memory_embeddings_chunk_model_unique').on(table.chunkId, table.modelId, table.modelVersion),
  byMemory: index('chronicle_memory_embeddings_memory_id_idx').on(table.memoryId),
  byStatus: index('chronicle_memory_embeddings_status_idx').on(table.status),
  byVectorHash: index('chronicle_memory_embeddings_vector_hash_idx').on(table.vectorHash),
}))

export const chronicleKnowledgeCards = sqliteTable('chronicle_knowledge_cards', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  cardType: text('card_type', {
    enum: ['fact', 'insight', 'decision', 'task', 'pattern'],
  }).notNull().default('fact'),
  dimension: text('dimension', {
    enum: ['technical', 'business', 'personal', 'project', 'general'],
  }).notNull().default('general'),
  confidenceBps: int('confidence_bps').notNull().default(10_000),
  sourceMemoryIdsJson: text('source_memory_ids_json').notNull().default('[]'),
  sourceSegmentIdsJson: text('source_segment_ids_json').notNull().default('[]'),
  sourceChunkIdsJson: text('source_chunk_ids_json').notNull().default('[]'),
  tagsJson: text('tags_json').notNull().default('[]'),
  stableKey: text('stable_key').notNull().default(''),
  contentHash: text('content_hash').notNull(),
  version: int('version').notNull().default(1),
  status: text('status', {
    enum: ['active', 'merged', 'archived', 'deleted'],
  }).notNull().default('active'),
  mergedIntoId: text('merged_into_id'),
  pinned: int('pinned', { mode: 'boolean' }).notNull().default(false),
  sortOrder: int('sort_order').notNull().default(0),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byContentHash: index('chronicle_knowledge_cards_content_hash_idx').on(table.contentHash),
  byStableKey: index('chronicle_knowledge_cards_stable_key_idx').on(table.stableKey),
  byWorkspaceUpdatedAt: index('chronicle_knowledge_cards_workspace_updated_at_idx').on(table.workspaceId, table.updatedAt),
  byDimension: index('chronicle_knowledge_cards_dimension_idx').on(table.dimension),
  byType: index('chronicle_knowledge_cards_type_idx').on(table.cardType),
  byStatus: index('chronicle_knowledge_cards_status_idx').on(table.status),
  byPinned: index('chronicle_knowledge_cards_pinned_idx').on(table.pinned),
  byMergedInto: index('chronicle_knowledge_cards_merged_into_idx').on(table.mergedIntoId),
}))

export const chronicleKnowledgeVersions = sqliteTable('chronicle_knowledge_versions', {
  id: textPk(),
  knowledgeId: text('knowledge_id')
    .notNull()
    .references(() => chronicleKnowledgeCards.id, { onDelete: 'cascade' }),
  version: int('version').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  cardType: text('card_type', {
    enum: ['fact', 'insight', 'decision', 'task', 'pattern'],
  }).notNull().default('fact'),
  dimension: text('dimension', {
    enum: ['technical', 'business', 'personal', 'project', 'general'],
  }).notNull().default('general'),
  confidenceBps: int('confidence_bps').notNull().default(10_000),
  sourceMemoryIdsJson: text('source_memory_ids_json').notNull().default('[]'),
  sourceSegmentIdsJson: text('source_segment_ids_json').notNull().default('[]'),
  sourceChunkIdsJson: text('source_chunk_ids_json').notNull().default('[]'),
  tagsJson: text('tags_json').notNull().default('[]'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  createdAt: int('created_at').notNull(),
}, table => ({
  byKnowledgeVersion: uniqueIndex('chronicle_knowledge_versions_card_version_unique').on(table.knowledgeId, table.version),
  byKnowledge: index('chronicle_knowledge_versions_knowledge_id_idx').on(table.knowledgeId),
  byCreatedAt: index('chronicle_knowledge_versions_created_at_idx').on(table.createdAt),
}))

export const chronicleKnowledgeFiles = sqliteTable('chronicle_knowledge_files', {
  id: textPk(),
  knowledgeId: text('knowledge_id')
    .notNull()
    .references(() => chronicleKnowledgeCards.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  contentType: text('content_type'),
  sizeBytes: int('size_bytes'),
  filePath: text('file_path'),
  embedded: int('embedded', { mode: 'boolean' }).notNull().default(false),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byKnowledge: index('chronicle_knowledge_files_knowledge_id_idx').on(table.knowledgeId),
}))

export const chronicleKnowledgeSources = sqliteTable('chronicle_knowledge_sources', {
  id: textPk(),
  knowledgeId: text('knowledge_id')
    .notNull()
    .references(() => chronicleKnowledgeCards.id, { onDelete: 'cascade' }),
  versionId: text('version_id')
    .references(() => chronicleKnowledgeVersions.id, { onDelete: 'cascade' }),
  segmentId: text('segment_id')
    .references(() => chronicleActivitySegments.id, { onDelete: 'set null' }),
  memoryId: text('memory_id')
    .references(() => chronicleMemories.id, { onDelete: 'set null' }),
  memoryChunkId: text('memory_chunk_id')
    .references(() => chronicleMemoryChunks.id, { onDelete: 'set null' }),
  pipelineRunId: text('pipeline_run_id')
    .references(() => chroniclePipelineRuns.id, { onDelete: 'set null' }),
  sourceKind: text('source_kind', {
    enum: ['activity', 'memory', 'chat', 'meeting', 'inference'],
  }).notNull().default('activity'),
  evidenceType: text('evidence_type').notNull().default('activity-segment'),
  evidenceId: text('evidence_id').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byKnowledge: index('chronicle_knowledge_sources_knowledge_id_idx').on(table.knowledgeId),
  byVersion: index('chronicle_knowledge_sources_version_id_idx').on(table.versionId),
  bySegment: index('chronicle_knowledge_sources_segment_id_idx').on(table.segmentId),
  byMemory: index('chronicle_knowledge_sources_memory_id_idx').on(table.memoryId),
  byChunk: index('chronicle_knowledge_sources_memory_chunk_id_idx').on(table.memoryChunkId),
  byPipelineRun: index('chronicle_knowledge_sources_pipeline_run_id_idx').on(table.pipelineRunId),
  byEvidence: index('chronicle_knowledge_sources_evidence_idx').on(table.evidenceType, table.evidenceId),
}))

export const chronicleAudioTranscripts = sqliteTable('chronicle_audio_transcripts', {
  id: textPk(),
  sourceId: text('source_id').notNull(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  memoryId: text('memory_id')
    .references(() => chronicleMemories.id, { onDelete: 'set null' }),
  title: text('title'),
  source: text('source', { enum: ['asr', 'manual', 'imported'] }).notNull().default('imported'),
  status: text('status', { enum: ['recording', 'completed', 'imported', 'error'] }).notNull().default('imported'),
  startedAt: int('started_at').notNull(),
  endedAt: int('ended_at'),
  language: text('language'),
  appBundleId: text('app_bundle_id'),
  windowTitle: text('window_title'),
  audioPath: text('audio_path'),
  transcriptPath: text('transcript_path'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  bySourceId: uniqueIndex('chronicle_audio_transcripts_source_id_unique').on(table.sourceId),
  byStartedAt: index('chronicle_audio_transcripts_started_at_idx').on(table.startedAt),
  byWorkspaceStartedAt: index('chronicle_audio_transcripts_workspace_started_at_idx').on(table.workspaceId, table.startedAt),
  byMemory: index('chronicle_audio_transcripts_memory_id_idx').on(table.memoryId),
  byStatus: index('chronicle_audio_transcripts_status_idx').on(table.status),
}))

export const chronicleAudioSegments = sqliteTable('chronicle_audio_segments', {
  id: textPk(),
  transcriptId: text('transcript_id')
    .notNull()
    .references(() => chronicleAudioTranscripts.id, { onDelete: 'cascade' }),
  segmentIndex: int('segment_index').notNull(),
  startMs: int('start_ms').notNull(),
  endMs: int('end_ms'),
  speakerLabel: text('speaker_label'),
  text: text('text').notNull(),
  confidenceBps: int('confidence_bps'),
  language: text('language'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byTranscriptSegment: uniqueIndex('chronicle_audio_segments_transcript_segment_unique').on(table.transcriptId, table.segmentIndex),
  byTranscript: index('chronicle_audio_segments_transcript_id_idx').on(table.transcriptId),
  bySpeaker: index('chronicle_audio_segments_speaker_label_idx').on(table.speakerLabel),
}))

export const chronicleSpeakerProfiles = sqliteTable('chronicle_speaker_profiles', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  stableKey: text('stable_key').notNull(),
  displayName: text('display_name').notNull(),
  normalizedLabel: text('normalized_label').notNull(),
  aliasesJson: text('aliases_json').notNull().default('[]'),
  embeddingJson: text('embedding_json'),
  embeddingDimensions: int('embedding_dimensions'),
  embeddingModelId: text('embedding_model_id'),
  sampleCount: int('sample_count').notNull().default(0),
  lastSeenAt: int('last_seen_at'),
  sourceTranscriptId: text('source_transcript_id')
    .references(() => chronicleAudioTranscripts.id, { onDelete: 'set null' }),
  sourceSegmentId: text('source_segment_id')
    .references(() => chronicleAudioSegments.id, { onDelete: 'set null' }),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byStableKey: uniqueIndex('chronicle_speaker_profiles_stable_key_unique').on(table.stableKey),
  byWorkspaceLastSeen: index('chronicle_speaker_profiles_workspace_last_seen_idx').on(table.workspaceId, table.lastSeenAt),
  byNormalizedLabel: index('chronicle_speaker_profiles_normalized_label_idx').on(table.normalizedLabel),
  bySourceTranscript: index('chronicle_speaker_profiles_source_transcript_id_idx').on(table.sourceTranscriptId),
  bySourceSegment: index('chronicle_speaker_profiles_source_segment_id_idx').on(table.sourceSegmentId),
}))

export const chronicleAudioRawSegments = sqliteTable('chronicle_audio_raw_segments', {
  id: textPk(),
  sourceId: text('source_id').notNull(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  recordedAt: int('recorded_at').notNull(),
  source: text('source', { enum: ['microphone', 'system', 'mixed'] }).notNull().default('microphone'),
  status: text('status', {
    enum: ['captured', 'queued', 'processed', 'ignored', 'error'],
  }).notNull().default('captured'),
  audioPath: text('audio_path').notNull(),
  metadataPath: text('metadata_path').notNull(),
  sampleRate: int('sample_rate').notNull(),
  channels: int('channels').notNull(),
  sampleCount: int('sample_count').notNull(),
  droppedSamples: int('dropped_samples').notNull().default(0),
  durationMs: int('duration_ms').notNull(),
  rmsBps: int('rms_bps').notNull().default(0),
  peakBps: int('peak_bps').notNull().default(0),
  active: int('active', { mode: 'boolean' }).notNull().default(false),
  vadStatus: text('vad_status', {
    enum: ['not-implemented', 'pending', 'ready', 'error'],
  }).notNull().default('not-implemented'),
  asrStatus: text('asr_status', {
    enum: ['not-implemented', 'pending', 'ready', 'error'],
  }).notNull().default('not-implemented'),
  speakerStatus: text('speaker_status', {
    enum: ['not-implemented', 'pending', 'ready', 'error'],
  }).notNull().default('not-implemented'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  bySourceId: uniqueIndex('chronicle_audio_raw_segments_source_id_unique').on(table.sourceId),
  byRecordedAt: index('chronicle_audio_raw_segments_recorded_at_idx').on(table.recordedAt),
  byWorkspaceRecordedAt: index('chronicle_audio_raw_segments_workspace_recorded_at_idx').on(table.workspaceId, table.recordedAt),
  byStatus: index('chronicle_audio_raw_segments_status_idx').on(table.status),
  byActive: index('chronicle_audio_raw_segments_active_idx').on(table.active),
}))

export const chronicleModelResources = sqliteTable('chronicle_model_resources', {
  id: textPk(),
  category: text('category', {
    enum: ['ocr', 'audio-vad', 'audio-asr', 'speaker', 'embedding', 'pii'],
  }).notNull(),
  status: text('status', {
    enum: ['available', 'missing', 'installing', 'installed', 'error'],
  }).notNull().default('missing'),
  displayName: text('display_name').notNull(),
  path: text('path'),
  version: text('version'),
  message: text('message'),
  sizeBytes: int('size_bytes'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byCategory: uniqueIndex('chronicle_model_resources_category_unique').on(table.category),
  byStatus: index('chronicle_model_resources_status_idx').on(table.status),
}))

export const chronicleMessageSources = sqliteTable('chronicle_message_sources', {
  id: textPk(),
  platform: text('platform', { enum: ['slack'] }).notNull(),
  label: text('label').notNull(),
  enabled: int('enabled', { mode: 'boolean' }).notNull().default(true),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  teamId: text('team_id'),
  botTokenRef: text('bot_token_ref'),
  channelIdsJson: text('channel_ids_json').notNull().default('[]'),
  configJson: text('config_json').notNull().default('{}'),
  status: text('status', {
    enum: ['idle', 'syncing', 'ready', 'error', 'disabled'],
  }).notNull().default('idle'),
  lastSyncAt: int('last_sync_at'),
  lastMessageAt: int('last_message_at'),
  lastError: text('last_error'),
  ...timestamps(),
}, table => ({
  byPlatformEnabled: index('chronicle_message_sources_platform_enabled_idx').on(table.platform, table.enabled),
  byWorkspace: index('chronicle_message_sources_workspace_id_idx').on(table.workspaceId),
}))

export const chronicleMessages = sqliteTable('chronicle_messages', {
  id: textPk(),
  sourceId: text('source_id')
    .notNull()
    .references(() => chronicleMessageSources.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  platform: text('platform', { enum: ['slack'] }).notNull(),
  externalMessageId: text('external_message_id').notNull(),
  teamId: text('team_id'),
  channelId: text('channel_id').notNull(),
  channelName: text('channel_name'),
  threadId: text('thread_id'),
  userId: text('user_id'),
  userName: text('user_name'),
  text: text('text').notNull().default(''),
  isDm: int('is_dm', { mode: 'boolean' }).notNull().default(false),
  messageTs: text('message_ts').notNull(),
  messageAt: int('message_at').notNull(),
  permalink: text('permalink'),
  attachmentsJson: text('attachments_json').notNull().default('[]'),
  rawJson: text('raw_json').notNull().default('{}'),
  dedupHash: text('dedup_hash').notNull(),
  ...timestamps(),
}, table => ({
  byExternalMessage: uniqueIndex('chronicle_messages_source_external_unique').on(table.sourceId, table.externalMessageId),
  bySourceMessageAt: index('chronicle_messages_source_message_at_idx').on(table.sourceId, table.messageAt),
  byWorkspaceMessageAt: index('chronicle_messages_workspace_message_at_idx').on(table.workspaceId, table.messageAt),
  byDedupHash: index('chronicle_messages_dedup_hash_idx').on(table.dedupHash),
}))

export const chronicleEvents = sqliteTable('chronicle_events', {
  id: textPk(),
  type: text('type', {
    enum: ['config', 'daemon', 'snapshot', 'memory', 'summarize', 'model-resource', 'message', 'audio', 'activity'],
  }).notNull(),
  status: text('status', {
    enum: ['info', 'success', 'warning', 'error'],
  }).notNull().default('info'),
  message: text('message').notNull(),
  snapshotId: text('snapshot_id')
    .references(() => chronicleSnapshots.id, { onDelete: 'set null' }),
  memoryId: text('memory_id')
    .references(() => chronicleMemories.id, { onDelete: 'set null' }),
  attrsJson: text('attrs_json').notNull().default('{}'),
  createdAt: int('created_at').notNull(),
}, table => ({
  byCreatedAt: index('chronicle_events_created_at_idx').on(table.createdAt),
  byTypeCreatedAt: index('chronicle_events_type_created_at_idx').on(table.type, table.createdAt),
  bySnapshot: index('chronicle_events_snapshot_id_idx').on(table.snapshotId),
  byMemory: index('chronicle_events_memory_id_idx').on(table.memoryId),
}))

export const chroniclePipelineRuns = sqliteTable('chronicle_pipeline_runs', {
  id: textPk(),
  sessionId: text('session_id')
    .references(() => chronicleActivitySessions.id, { onDelete: 'set null' }),
  segmentId: text('segment_id')
    .references(() => chronicleActivitySegments.id, { onDelete: 'set null' }),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  trigger: text('trigger', {
    enum: ['snapshot', 'message', 'audio-raw', 'audio-transcript', 'memory', 'manual', 'summarize'],
  }).notNull(),
  sourceKey: text('source_key').notNull(),
  stage: text('stage', {
    enum: ['collection', 'segmentation', 'triage', 'summarization', 'crystallization'],
  }).notNull().default('collection'),
  status: text('status', {
    enum: ['queued', 'running', 'success', 'error', 'skipped'],
  }).notNull().default('queued'),
  startedAt: int('started_at').notNull(),
  endedAt: int('ended_at'),
  errorMessage: text('error_message'),
  snapshotIdsJson: text('snapshot_ids_json').notNull().default('[]'),
  messageIdsJson: text('message_ids_json').notNull().default('[]'),
  audioTranscriptIdsJson: text('audio_transcript_ids_json').notNull().default('[]'),
  audioRawSegmentIdsJson: text('audio_raw_segment_ids_json').notNull().default('[]'),
  memoryIdsJson: text('memory_ids_json').notNull().default('[]'),
  segmentIdsJson: text('segment_ids_json').notNull().default('[]'),
  snapshotsCount: int('snapshots_count').notNull().default(0),
  messagesCount: int('messages_count').notNull().default(0),
  audioTranscriptsCount: int('audio_transcripts_count').notNull().default(0),
  audioRawSegmentsCount: int('audio_raw_segments_count').notNull().default(0),
  memoriesCount: int('memories_count').notNull().default(0),
  segmentsCount: int('segments_count').notNull().default(0),
  triageResultsJson: text('triage_results_json').notNull().default('{}'),
  summaryResultsJson: text('summary_results_json').notNull().default('{}'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  bySourceKey: uniqueIndex('chronicle_pipeline_runs_source_key_unique').on(table.sourceKey),
  byStatus: index('chronicle_pipeline_runs_status_idx').on(table.status),
  bySession: index('chronicle_pipeline_runs_session_id_idx').on(table.sessionId),
  bySegment: index('chronicle_pipeline_runs_segment_id_idx').on(table.segmentId),
  byStartedAt: index('chronicle_pipeline_runs_started_at_idx').on(table.startedAt),
  byWorkspaceStartedAt: index('chronicle_pipeline_runs_workspace_started_at_idx').on(table.workspaceId, table.startedAt),
}))

export const chronicleDreamRuns = sqliteTable('chronicle_dream_runs', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  runType: text('run_type', {
    enum: ['archive', 'merge', 'prune', 'restore', 'dry-run'],
  }).notNull(),
  status: text('status', {
    enum: ['running', 'completed', 'failed'],
  }).notNull().default('running'),
  startedAt: int('started_at').notNull(),
  endedAt: int('ended_at'),
  inputCount: int('input_count').notNull().default(0),
  outputCount: int('output_count').notNull().default(0),
  mergedCount: int('merged_count').notNull().default(0),
  deletedCount: int('deleted_count').notNull().default(0),
  sourceKnowledgeIdsJson: text('source_knowledge_ids_json').notNull().default('[]'),
  outputKnowledgeIdsJson: text('output_knowledge_ids_json').notNull().default('[]'),
  configJson: text('config_json').notNull().default('{}'),
  resultJson: text('result_json').notNull().default('{}'),
  errorMessage: text('error_message'),
  ...timestamps(),
}, table => ({
  byWorkspaceStartedAt: index('chronicle_dream_runs_workspace_started_at_idx').on(table.workspaceId, table.startedAt),
  byRunType: index('chronicle_dream_runs_run_type_idx').on(table.runType),
  byStatus: index('chronicle_dream_runs_status_idx').on(table.status),
  byStartedAt: index('chronicle_dream_runs_started_at_idx').on(table.startedAt),
}))

export const chronicleDreamCandidates = sqliteTable('chronicle_dream_candidates', {
  id: textPk(),
  runId: text('run_id')
    .notNull()
    .references(() => chronicleDreamRuns.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id')
    .references(() => workspaces.id, { onDelete: 'set null' }),
  candidateType: text('candidate_type', {
    enum: ['merge', 'archive', 'prune', 'restore'],
  }).notNull().default('merge'),
  scoreBps: int('score_bps').notNull().default(0),
  sourceKnowledgeIdsJson: text('source_knowledge_ids_json').notNull().default('[]'),
  proposedTitle: text('proposed_title'),
  proposedContent: text('proposed_content'),
  proposedCardType: text('proposed_card_type', {
    enum: ['fact', 'insight', 'decision', 'task', 'pattern'],
  }),
  proposedDimension: text('proposed_dimension', {
    enum: ['technical', 'business', 'personal', 'project', 'general'],
  }),
  outputKnowledgeId: text('output_knowledge_id')
    .references(() => chronicleKnowledgeCards.id, { onDelete: 'set null' }),
  status: text('status', {
    enum: ['proposed', 'applied', 'rejected', 'failed'],
  }).notNull().default('proposed'),
  reason: text('reason'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  ...timestamps(),
}, table => ({
  byRun: index('chronicle_dream_candidates_run_id_idx').on(table.runId),
  byWorkspace: index('chronicle_dream_candidates_workspace_id_idx').on(table.workspaceId),
  byStatus: index('chronicle_dream_candidates_status_idx').on(table.status),
  byScore: index('chronicle_dream_candidates_score_idx').on(table.scoreBps),
  byOutputKnowledge: index('chronicle_dream_candidates_output_knowledge_id_idx').on(table.outputKnowledgeId),
}))

export type ChronicleSnapshot = typeof chronicleSnapshots.$inferSelect
export type NewChronicleSnapshot = typeof chronicleSnapshots.$inferInsert
export type ChronicleAccessibilitySnapshot = typeof chronicleAccessibilitySnapshots.$inferSelect
export type NewChronicleAccessibilitySnapshot = typeof chronicleAccessibilitySnapshots.$inferInsert
export type ChronicleAccessibilityEvent = typeof chronicleAccessibilityEvents.$inferSelect
export type NewChronicleAccessibilityEvent = typeof chronicleAccessibilityEvents.$inferInsert
export type ChronicleActivitySession = typeof chronicleActivitySessions.$inferSelect
export type NewChronicleActivitySession = typeof chronicleActivitySessions.$inferInsert
export type ChronicleActivitySegment = typeof chronicleActivitySegments.$inferSelect
export type NewChronicleActivitySegment = typeof chronicleActivitySegments.$inferInsert
export type ChronicleMemory = typeof chronicleMemories.$inferSelect
export type NewChronicleMemory = typeof chronicleMemories.$inferInsert
export type ChronicleMemoryChunk = typeof chronicleMemoryChunks.$inferSelect
export type NewChronicleMemoryChunk = typeof chronicleMemoryChunks.$inferInsert
export type ChronicleMemoryKeyword = typeof chronicleMemoryKeywords.$inferSelect
export type NewChronicleMemoryKeyword = typeof chronicleMemoryKeywords.$inferInsert
export type ChronicleMemoryEmbedding = typeof chronicleMemoryEmbeddings.$inferSelect
export type NewChronicleMemoryEmbedding = typeof chronicleMemoryEmbeddings.$inferInsert
export type ChronicleKnowledgeCard = typeof chronicleKnowledgeCards.$inferSelect
export type NewChronicleKnowledgeCard = typeof chronicleKnowledgeCards.$inferInsert
export type ChronicleKnowledgeVersion = typeof chronicleKnowledgeVersions.$inferSelect
export type NewChronicleKnowledgeVersion = typeof chronicleKnowledgeVersions.$inferInsert
export type ChronicleKnowledgeFile = typeof chronicleKnowledgeFiles.$inferSelect
export type NewChronicleKnowledgeFile = typeof chronicleKnowledgeFiles.$inferInsert
export type ChronicleKnowledgeSource = typeof chronicleKnowledgeSources.$inferSelect
export type NewChronicleKnowledgeSource = typeof chronicleKnowledgeSources.$inferInsert
export type ChronicleAudioTranscript = typeof chronicleAudioTranscripts.$inferSelect
export type NewChronicleAudioTranscript = typeof chronicleAudioTranscripts.$inferInsert
export type ChronicleAudioSegment = typeof chronicleAudioSegments.$inferSelect
export type NewChronicleAudioSegment = typeof chronicleAudioSegments.$inferInsert
export type ChronicleSpeakerProfile = typeof chronicleSpeakerProfiles.$inferSelect
export type NewChronicleSpeakerProfile = typeof chronicleSpeakerProfiles.$inferInsert
export type ChronicleModelResource = typeof chronicleModelResources.$inferSelect
export type NewChronicleModelResource = typeof chronicleModelResources.$inferInsert
export type ChronicleMessageSource = typeof chronicleMessageSources.$inferSelect
export type NewChronicleMessageSource = typeof chronicleMessageSources.$inferInsert
export type ChronicleMessage = typeof chronicleMessages.$inferSelect
export type NewChronicleMessage = typeof chronicleMessages.$inferInsert
export type ChronicleEvent = typeof chronicleEvents.$inferSelect
export type NewChronicleEvent = typeof chronicleEvents.$inferInsert
export type ChroniclePipelineRun = typeof chroniclePipelineRuns.$inferSelect
export type NewChroniclePipelineRun = typeof chroniclePipelineRuns.$inferInsert
export type ChronicleDreamRun = typeof chronicleDreamRuns.$inferSelect
export type NewChronicleDreamRun = typeof chronicleDreamRuns.$inferInsert
export type ChronicleDreamCandidate = typeof chronicleDreamCandidates.$inferSelect
export type NewChronicleDreamCandidate = typeof chronicleDreamCandidates.$inferInsert
