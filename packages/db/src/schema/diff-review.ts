import { index, int, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { textPk, timestamps, workspaces } from './shared'

export const diffReviews = sqliteTable('diff_reviews', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceId: text('source_id'),
  repositoryPath: text('repository_path').notNull(),
  sourceKind: text('source_kind', {
    enum: ['local-working-tree', 'local-branch-compare', 'local-commit', 'agent-change-set', 'github-pull-request', 'external-import'],
  }).notNull(),
  title: text('title').notNull(),
  status: text('status', {
    enum: ['open', 'merged', 'closed', 'abandoned'],
  }).notNull().default('open'),
  reviewState: text('review_state', {
    enum: ['unreviewed', 'in-review', 'changes-requested', 'approved', 'commented'],
  }).notNull().default('unreviewed'),
  currentRevisionId: text('current_revision_id'),
  ...timestamps(),
}, table => ({
  byWorkspace: index('diff_reviews_workspace_id_idx').on(table.workspaceId),
  bySource: index('diff_reviews_source_id_idx').on(table.sourceId),
  byCurrentRevision: index('diff_reviews_current_revision_id_idx').on(table.currentRevisionId),
  sourceUnique: uniqueIndex('diff_reviews_source_unique').on(table.sourceId),
}))

export const diffReviewSources = sqliteTable('diff_review_sources', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind', {
    enum: ['local-working-tree', 'local-branch-compare', 'local-commit', 'agent-change-set', 'github-pull-request', 'external-import'],
  }).notNull(),
  ownerNamespace: text('owner_namespace').notNull().default('diff-review'),
  bindingJson: text('binding_json').notNull().default('{}'),
  refreshPolicy: text('refresh_policy', {
    enum: ['manual', 'webhook', 'watch-worktree', 'session-event'],
  }).notNull().default('manual'),
  ...timestamps(),
}, table => ({
  byWorkspace: index('diff_review_sources_workspace_id_idx').on(table.workspaceId),
  byKind: index('diff_review_sources_kind_idx').on(table.kind),
}))

export const diffReviewRevisions = sqliteTable('diff_review_revisions', {
  id: textPk(),
  reviewId: text('review_id')
    .notNull()
    .references(() => diffReviews.id, { onDelete: 'cascade' }),
  sourceVersion: text('source_version').notNull(),
  patchHash: text('patch_hash').notNull(),
  fileCount: int('file_count').notNull().default(0),
  additions: int('additions').notNull().default(0),
  deletions: int('deletions').notNull().default(0),
  patch: text('patch').notNull(),
  generatedAt: int('generated_at').notNull(),
}, table => ({
  byReview: index('diff_review_revisions_review_id_idx').on(table.reviewId),
  reviewPatchUnique: uniqueIndex('diff_review_revisions_review_patch_unique').on(table.reviewId, table.patchHash),
}))

export const diffReviewFiles = sqliteTable('diff_review_files', {
  id: textPk(),
  revisionId: text('revision_id')
    .notNull()
    .references(() => diffReviewRevisions.id, { onDelete: 'cascade' }),
  path: text('path').notNull(),
  previousPath: text('previous_path'),
  status: text('status', {
    enum: ['added', 'modified', 'deleted', 'renamed', 'untracked'],
  }).notNull(),
  additions: int('additions').notNull().default(0),
  deletions: int('deletions').notNull().default(0),
  isGenerated: int('is_generated', { mode: 'boolean' }).notNull().default(false),
  isBinary: int('is_binary', { mode: 'boolean' }).notNull().default(false),
  isViewed: int('is_viewed', { mode: 'boolean' }).notNull().default(false),
}, table => ({
  byRevision: index('diff_review_files_revision_id_idx').on(table.revisionId),
  revisionPathUnique: uniqueIndex('diff_review_files_revision_path_unique').on(table.revisionId, table.path),
}))

export const diffReviewThreads = sqliteTable('diff_review_threads', {
  id: textPk(),
  reviewId: text('review_id')
    .notNull()
    .references(() => diffReviews.id, { onDelete: 'cascade' }),
  originalRevisionId: text('original_revision_id')
    .notNull()
    .references(() => diffReviewRevisions.id, { onDelete: 'cascade' }),
  currentRevisionId: text('current_revision_id')
    .references(() => diffReviewRevisions.id, { onDelete: 'set null' }),
  fileId: text('file_id')
    .references(() => diffReviewFiles.id, { onDelete: 'set null' }),
  anchorJson: text('anchor_json'),
  state: text('state', {
    enum: ['open', 'resolved', 'stale'],
  }).notNull().default('open'),
  createdBy: text('created_by').notNull(),
  resolvedBy: text('resolved_by'),
  resolvedAt: int('resolved_at'),
  ...timestamps(),
}, table => ({
  byReview: index('diff_review_threads_review_id_idx').on(table.reviewId),
  byState: index('diff_review_threads_state_idx').on(table.state),
  byCurrentRevision: index('diff_review_threads_current_revision_id_idx').on(table.currentRevisionId),
}))

export const diffReviewComments = sqliteTable('diff_review_comments', {
  id: textPk(),
  threadId: text('thread_id')
    .notNull()
    .references(() => diffReviewThreads.id, { onDelete: 'cascade' }),
  authorKind: text('author_kind', {
    enum: ['user', 'agent', 'external'],
  }).notNull().default('user'),
  authorId: text('author_id').notNull(),
  bodyMarkdown: text('body_markdown').notNull(),
  externalUrl: text('external_url'),
  ...timestamps(),
}, table => ({
  byThread: index('diff_review_comments_thread_id_idx').on(table.threadId),
}))

export const diffReviewThreadReactions = sqliteTable('diff_review_thread_reactions', {
  id: textPk(),
  threadId: text('thread_id')
    .notNull()
    .references(() => diffReviewThreads.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  reaction: text('reaction').notNull(),
  createdAt: int('created_at').notNull(),
}, table => ({
  byThread: index('diff_review_thread_reactions_thread_id_idx').on(table.threadId),
  reactionUnique: uniqueIndex('diff_review_thread_reactions_unique').on(table.threadId, table.userId, table.reaction),
}))

export const diffReviewSubmissions = sqliteTable('diff_review_submissions', {
  id: textPk(),
  reviewId: text('review_id')
    .notNull()
    .references(() => diffReviews.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id')
    .notNull()
    .references(() => diffReviewRevisions.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(),
  decision: text('decision', {
    enum: ['approve', 'request-changes', 'comment'],
  }).notNull(),
  bodyMarkdown: text('body_markdown'),
  submittedAt: int('submitted_at').notNull(),
  sourceSyncState: text('source_sync_state', {
    enum: ['local-only', 'pending', 'synced', 'failed'],
  }).notNull().default('local-only'),
}, table => ({
  byReview: index('diff_review_submissions_review_id_idx').on(table.reviewId),
  byRevision: index('diff_review_submissions_revision_id_idx').on(table.revisionId),
}))

export const diffReviewFileViewState = sqliteTable('diff_review_file_view_state', {
  id: textPk(),
  reviewId: text('review_id')
    .notNull()
    .references(() => diffReviews.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id')
    .notNull()
    .references(() => diffReviewRevisions.id, { onDelete: 'cascade' }),
  fileId: text('file_id')
    .notNull()
    .references(() => diffReviewFiles.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  viewed: int('viewed', { mode: 'boolean' }).notNull().default(true),
  viewedAt: int('viewed_at').notNull(),
}, table => ({
  byReview: index('diff_review_file_view_state_review_id_idx').on(table.reviewId),
  byRevision: index('diff_review_file_view_state_revision_id_idx').on(table.revisionId),
  fileUserUnique: uniqueIndex('diff_review_file_view_state_file_user_unique').on(
    table.reviewId,
    table.revisionId,
    table.fileId,
    table.userId,
  ),
}))

export const diffReviewAgentFixes = sqliteTable('diff_review_agent_fixes', {
  id: textPk(),
  reviewId: text('review_id')
    .notNull()
    .references(() => diffReviews.id, { onDelete: 'cascade' }),
  targetRevisionId: text('target_revision_id')
    .references(() => diffReviewRevisions.id, { onDelete: 'set null' }),
  threadId: text('thread_id')
    .references(() => diffReviewThreads.id, { onDelete: 'set null' }),
  anchorJson: text('anchor_json'),
  instruction: text('instruction').notNull(),
  profileId: text('profile_id'),
  expectedOutput: text('expected_output', {
    enum: ['commit', 'working-tree-change', 'patch-artifact'],
  }).notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
  }).notNull().default('pending'),
  sessionId: text('session_id'),
  runId: text('run_id'),
  artifactId: text('artifact_id'),
  resultRevisionId: text('result_revision_id')
    .references(() => diffReviewRevisions.id, { onDelete: 'set null' }),
  errorMessage: text('error_message'),
  ...timestamps(),
}, table => ({
  byReview: index('diff_review_agent_fixes_review_id_idx').on(table.reviewId),
  byTargetRevision: index('diff_review_agent_fixes_target_revision_id_idx').on(table.targetRevisionId),
  byThread: index('diff_review_agent_fixes_thread_id_idx').on(table.threadId),
  byResultRevision: index('diff_review_agent_fixes_result_revision_id_idx').on(table.resultRevisionId),
  byStatus: index('diff_review_agent_fixes_status_idx').on(table.status),
}))

export const diffReviewSourceOperations = sqliteTable('diff_review_source_operations', {
  id: textPk(),
  sourceId: text('source_id')
    .references(() => diffReviewSources.id, { onDelete: 'cascade' }),
  reviewId: text('review_id')
    .notNull()
    .references(() => diffReviews.id, { onDelete: 'cascade' }),
  operationKind: text('operation_kind').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  status: text('status', {
    enum: ['pending', 'succeeded', 'failed'],
  }).notNull().default('pending'),
  requestJson: text('request_json').notNull().default('{}'),
  responseJson: text('response_json'),
  errorMessage: text('error_message'),
  ...timestamps(),
}, table => ({
  byReview: index('diff_review_source_operations_review_id_idx').on(table.reviewId),
  bySource: index('diff_review_source_operations_source_id_idx').on(table.sourceId),
  idempotencyUnique: uniqueIndex('diff_review_source_operations_idempotency_unique').on(
    table.sourceId,
    table.operationKind,
    table.idempotencyKey,
  ),
}))

export const diffReviewSourceReadinessCache = sqliteTable('diff_review_source_readiness_cache', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  sourceKind: text('source_kind', {
    enum: ['local-working-tree', 'local-branch-compare', 'local-commit', 'agent-change-set', 'github-pull-request', 'external-import'],
  }).notNull(),
  state: text('state', {
    enum: [
      'ready',
      'workspace-integration-missing',
      'repository-code-access-missing',
      'personal-connection-missing',
      'permission-insufficient',
    ],
  }).notNull(),
  actionsJson: text('actions_json').notNull().default('[]'),
  updatedAt: int('updated_at').notNull(),
}, table => ({
  byWorkspace: index('diff_review_source_readiness_workspace_id_idx').on(table.workspaceId),
  sourceKindUnique: uniqueIndex('diff_review_source_readiness_kind_unique').on(table.workspaceId, table.sourceKind),
}))

export const diffReviewPreferences = sqliteTable('diff_review_preferences', {
  id: textPk(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  diffStyle: text('diff_style', {
    enum: ['split', 'unified'],
  }).notNull().default('split'),
  codeTheme: text('code_theme').notNull().default('system'),
  fontSize: int('font_size').notNull().default(11),
  lineHeight: int('line_height').notNull().default(18),
  hideWhitespaceOnly: int('hide_whitespace_only', { mode: 'boolean' }).notNull().default(false),
  structuralHighlighting: int('structural_highlighting', { mode: 'boolean' }).notNull().default(false),
  collapseGeneratedFiles: int('collapse_generated_files', { mode: 'boolean' }).notNull().default(false),
  notificationMode: text('notification_mode', {
    enum: ['all-activity', 'all-activity-by-people', 'reviews-and-comments', 'reviews-and-comments-by-people', 'none'],
  }).notNull().default('reviews-and-comments'),
  ...timestamps(),
}, table => ({
  byWorkspace: index('diff_review_preferences_workspace_id_idx').on(table.workspaceId),
  workspaceUserUnique: uniqueIndex('diff_review_preferences_workspace_user_unique').on(table.workspaceId, table.userId),
}))

export const diffReviewEvents = sqliteTable('diff_review_events', {
  id: textPk(),
  reviewId: text('review_id')
    .notNull()
    .references(() => diffReviews.id, { onDelete: 'cascade' }),
  eventKind: text('event_kind', {
    enum: [
      'review_created',
      'review_requested',
      'thread_created',
      'comment_created',
      'thread_resolved',
      'review_submitted',
      'review_closed',
      'revision_updated',
      'file_viewed',
      'preferences_updated',
      'agent_fix_created',
      'agent_fix_started',
      'agent_fix_completed',
      'agent_fix_failed',
      'agent_fix_cancelled',
      'agent_fix_deleted',
      'guide_cancelled',
      'commit_plan_created',
      'commit_plan_updated',
      'commit_plan_applied',
      'commit_plan_apply_failed',
      'source_readiness_changed',
      'merge_completed',
      'merge_failed',
    ],
  }).notNull(),
  actorKind: text('actor_kind', {
    enum: ['user', 'agent', 'external', 'system'],
  }).notNull().default('system'),
  actorId: text('actor_id'),
  payloadJson: text('payload_json').notNull().default('{}'),
  createdAt: int('created_at').notNull(),
}, table => ({
  byReview: index('diff_review_events_review_id_idx').on(table.reviewId),
  byCreatedAt: index('diff_review_events_created_at_idx').on(table.createdAt),
}))

export const diffReviewGuides = sqliteTable('diff_review_guides', {
  id: textPk(),
  reviewId: text('review_id')
    .notNull()
    .references(() => diffReviews.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id')
    .notNull()
    .references(() => diffReviewRevisions.id, { onDelete: 'cascade' }),
  providerTargetId: text('provider_target_id'),
  runtimeKind: text('runtime_kind').notNull(),
  modelId: text('model_id'),
  sessionId: text('session_id'),
  runId: text('run_id'),
  inputHash: text('input_hash').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'ready', 'failed', 'cancelled'],
  }).notNull(),
  title: text('title'),
  stepsJson: text('steps_json').notNull().default('[]'),
  errorMessage: text('error_message'),
  createdAt: int('created_at').notNull(),
  updatedAt: int('updated_at').notNull(),
}, table => ({
  byReview: index('diff_review_guides_review_id_idx').on(table.reviewId),
  byRevision: index('diff_review_guides_revision_id_idx').on(table.revisionId),
  reviewRevisionUnique: uniqueIndex('diff_review_guides_review_revision_unique').on(table.reviewId, table.revisionId),
}))

export const diffReviewCommitPlans = sqliteTable('diff_review_commit_plans', {
  id: textPk(),
  reviewId: text('review_id')
    .notNull()
    .references(() => diffReviews.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id')
    .notNull()
    .references(() => diffReviewRevisions.id, { onDelete: 'cascade' }),
  actorId: text('actor_id').notNull(),
  strategy: text('strategy', {
    enum: ['manual'],
  }).notNull(),
  status: text('status', {
    enum: ['draft', 'accepted', 'applied', 'abandoned'],
  }).notNull().default('draft'),
  groupsJson: text('groups_json').notNull(),
  rationale: text('rationale').notNull(),
  createdAt: int('created_at').notNull(),
  updatedAt: int('updated_at').notNull(),
}, table => ({
  byReview: index('diff_review_commit_plans_review_id_idx').on(table.reviewId),
  byRevision: index('diff_review_commit_plans_revision_id_idx').on(table.revisionId),
  byCreatedAt: index('diff_review_commit_plans_created_at_idx').on(table.createdAt),
}))

export type DiffReviewSource = typeof diffReviewSources.$inferSelect
export type NewDiffReviewSource = typeof diffReviewSources.$inferInsert
export type DiffReview = typeof diffReviews.$inferSelect
export type NewDiffReview = typeof diffReviews.$inferInsert
export type DiffReviewRevision = typeof diffReviewRevisions.$inferSelect
export type NewDiffReviewRevision = typeof diffReviewRevisions.$inferInsert
export type DiffReviewFile = typeof diffReviewFiles.$inferSelect
export type NewDiffReviewFile = typeof diffReviewFiles.$inferInsert
export type DiffReviewThread = typeof diffReviewThreads.$inferSelect
export type NewDiffReviewThread = typeof diffReviewThreads.$inferInsert
export type DiffReviewComment = typeof diffReviewComments.$inferSelect
export type NewDiffReviewComment = typeof diffReviewComments.$inferInsert
export type DiffReviewThreadReaction = typeof diffReviewThreadReactions.$inferSelect
export type NewDiffReviewThreadReaction = typeof diffReviewThreadReactions.$inferInsert
export type DiffReviewSubmission = typeof diffReviewSubmissions.$inferSelect
export type NewDiffReviewSubmission = typeof diffReviewSubmissions.$inferInsert
export type DiffReviewFileViewState = typeof diffReviewFileViewState.$inferSelect
export type NewDiffReviewFileViewState = typeof diffReviewFileViewState.$inferInsert
export type DiffReviewAgentFix = typeof diffReviewAgentFixes.$inferSelect
export type NewDiffReviewAgentFix = typeof diffReviewAgentFixes.$inferInsert
export type DiffReviewSourceOperation = typeof diffReviewSourceOperations.$inferSelect
export type NewDiffReviewSourceOperation = typeof diffReviewSourceOperations.$inferInsert
export type DiffReviewSourceReadiness = typeof diffReviewSourceReadinessCache.$inferSelect
export type NewDiffReviewSourceReadiness = typeof diffReviewSourceReadinessCache.$inferInsert
export type DiffReviewPreference = typeof diffReviewPreferences.$inferSelect
export type NewDiffReviewPreference = typeof diffReviewPreferences.$inferInsert
export type DiffReviewEvent = typeof diffReviewEvents.$inferSelect
export type NewDiffReviewEvent = typeof diffReviewEvents.$inferInsert
export type DiffReviewGuide = typeof diffReviewGuides.$inferSelect
export type NewDiffReviewGuide = typeof diffReviewGuides.$inferInsert
export type DiffReviewCommitPlan = typeof diffReviewCommitPlans.$inferSelect
export type NewDiffReviewCommitPlan = typeof diffReviewCommitPlans.$inferInsert
