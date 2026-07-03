import type { GitFileStatusKind } from '../git/service'
import type { RuntimeKind } from '../provider-contracts/types'

export interface DiffRevisionView {
  id: string
  reviewId: string
  sourceVersion: string
  patchHash: string
  fileCount: number
  additions: number
  deletions: number
  generatedAt: number
  patch: string
}

export interface ReviewFileDiffView {
  id: string
  revisionId: string
  path: string
  previousPath: string | null
  status: GitFileStatusKind
  additions: number
  deletions: number
  isGenerated: boolean
  isBinary: boolean
  isViewed: boolean
}

export interface ReviewThreadReactionView {
  id: string
  threadId: string
  userId: string
  reaction: string
  createdAt: number
}

export interface ReviewRangeAnchorView {
  revisionId: string
  fileId: string
  path: string
  side: 'base' | 'head'
  startLine: number
  endLine: number
  startColumn?: number
  endColumn?: number
  hunkHeader: string
  lineHash: string
  contextBeforeHash?: string
  contextAfterHash?: string
}

export interface ReviewCommentView {
  id: string
  threadId: string
  authorKind: 'user' | 'agent' | 'external'
  authorId: string
  bodyMarkdown: string
  externalUrl: string | null
  createdAt: number
  updatedAt: number
}

export interface ReviewThreadView {
  id: string
  reviewId: string
  originalRevisionId: string
  currentRevisionId: string | null
  fileId: string | null
  anchor: ReviewRangeAnchorView | null
  state: 'open' | 'resolved' | 'stale'
  createdBy: string
  createdAt: number
  updatedAt: number
  resolvedBy: string | null
  resolvedAt: number | null
  comments: ReviewCommentView[]
  reactions: ReviewThreadReactionView[]
}

export interface ReviewSubmissionView {
  id: string
  reviewId: string
  revisionId: string
  actorId: string
  decision: 'approve' | 'request-changes' | 'comment'
  bodyMarkdown: string | null
  submittedAt: number
  sourceSyncState: 'local-only' | 'pending' | 'synced' | 'failed'
}

export interface DiffReviewPreferenceView {
  id: string
  workspaceId: string
  userId: string
  diffStyle: 'split' | 'unified'
  codeTheme: string
  fontSize: number
  lineHeight: number
  hideWhitespaceOnly: boolean
  structuralHighlighting: boolean
  collapseGeneratedFiles: boolean
  notificationMode: 'all-activity' | 'all-activity-by-people' | 'reviews-and-comments' | 'reviews-and-comments-by-people' | 'none'
  createdAt: number
  updatedAt: number
}

export interface ReviewEventView {
  id: string
  reviewId: string
  eventKind:
    | 'review_created'
    | 'review_requested'
    | 'thread_created'
    | 'comment_created'
    | 'thread_resolved'
    | 'review_submitted'
    | 'review_closed'
    | 'revision_updated'
    | 'file_viewed'
    | 'preferences_updated'
    | 'agent_fix_created'
    | 'agent_fix_started'
    | 'agent_fix_completed'
    | 'agent_fix_failed'
    | 'agent_fix_cancelled'
    | 'agent_fix_deleted'
    | 'guide_cancelled'
    | 'commit_plan_created'
    | 'commit_plan_updated'
    | 'commit_plan_applied'
    | 'commit_plan_apply_failed'
    | 'source_readiness_changed'
    | 'merge_completed'
    | 'merge_failed'
  actorKind: 'user' | 'agent' | 'external' | 'system'
  actorId: string | null
  payload: unknown
  createdAt: number
}

export interface ReviewAgentFixView {
  id: string
  reviewId: string
  targetRevisionId: string | null
  threadId: string | null
  anchor: ReviewRangeAnchorView | null
  instruction: string
  profileId: string | null
  expectedOutput: 'commit' | 'working-tree-change' | 'patch-artifact'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  sessionId: string | null
  runId: string | null
  artifactId: string | null
  resultRevisionId: string | null
  errorMessage: string | null
  createdAt: number
  updatedAt: number
}

export interface ReviewAgentFixArtifactView {
  id: string
  reviewId: string
  agentFixId: string
  sessionId: string
  runId: string
  kind: 'patch' | 'assistant-summary'
  mimeType: string
  content: string
  contentHash: string
  createdAt: number
}

export interface ReviewCommitPlanGroupView {
  id: string
  title: string
  message: string
  rationale: string
  fileIds: string[]
  paths: string[]
  dependsOn: string[]
}

export interface ReviewCommitPlanConflictView {
  fileId: string
  path: string
  groupIds: string[]
}

export interface ReviewCommitPlanView {
  id: string
  reviewId: string
  revisionId: string
  actorId: string
  strategy: 'manual'
  status: 'draft' | 'accepted' | 'applied' | 'abandoned'
  groups: ReviewCommitPlanGroupView[]
  conflicts: ReviewCommitPlanConflictView[]
  rationale: string
  createdAt: number
  updatedAt: number
}

export interface ReviewCommitPlanGroupInput {
  id: string
  title: string
  message: string
  rationale: string
  fileIds: string[]
  paths?: string[]
  dependsOn: string[]
}

export interface ReviewGuideStepView {
  id: string
  title: string
  rationale: string
  fileIds: string[]
  threadIds: string[]
  anchors: ReviewRangeAnchorView[]
  order: number
}

export type ReviewGuideStatus = 'pending' | 'running' | 'ready' | 'failed' | 'cancelled'

export interface ReviewGuideView {
  revisionId: string | null
  status: ReviewGuideStatus | null
  providerTargetId: string | null
  runtimeKind: RuntimeKind | null
  modelId: string | null
  sessionId: string | null
  runId: string | null
  errorMessage: string | null
  createdAt: number | null
  updatedAt: number | null
  title: string | null
  steps: ReviewGuideStepView[]
}

export interface ReviewGuideGenerateInput {
  providerTargetId: string
  runtimeKind?: RuntimeKind
  modelId?: string | null
  force?: boolean
}

export interface ReviewSourceReadinessView {
  sourceKind: 'local-working-tree' | 'local-branch-compare' | 'local-commit' | 'agent-change-set' | 'github-pull-request' | 'external-import'
  workspaceId: string
  state:
    | 'ready'
    | 'workspace-integration-missing'
    | 'repository-code-access-missing'
    | 'personal-connection-missing'
    | 'permission-insufficient'
  actions: Array<{
    label: string
    url?: string
    ownerKind: 'workspace-admin' | 'github-org-owner' | 'current-user'
  }>
}

export interface DiffReviewView {
  id: string
  workspaceId: string
  sourceId: string | null
  repositoryPath: string
  sourceKind: 'local-working-tree' | 'local-branch-compare' | 'local-commit' | 'agent-change-set' | 'github-pull-request' | 'external-import'
  title: string
  status: 'open' | 'merged' | 'closed' | 'abandoned'
  reviewState: 'unreviewed' | 'in-review' | 'changes-requested' | 'approved' | 'commented'
  currentRevisionId: string | null
  createdAt: number
  updatedAt: number
  currentRevision: DiffRevisionView | null
  files: ReviewFileDiffView[]
  threads: ReviewThreadView[]
  submissions: ReviewSubmissionView[]
  events: ReviewEventView[]
  preferences: DiffReviewPreferenceView
  guide: ReviewGuideView
  agentFixes: ReviewAgentFixView[]
  commitPlans: ReviewCommitPlanView[]
}

export type ReviewSourceKind = DiffReviewView['sourceKind']

export interface BranchCompareBinding {
  repositoryPath: string
  baseRef: string
  headRef: string
}

export interface LocalCommitBinding {
  repositoryPath: string
  commitSha: string
}

export type ReviewEventKind = ReviewEventView['eventKind']
export type ReviewActorKind = ReviewEventView['actorKind']

export interface ReviewRangeAnchorInput {
  fileId: string
  side?: 'base' | 'head'
  startLine: number
  endLine?: number
  startColumn?: number
  endColumn?: number
}
