import type { Command } from 'commander'

import { register as registerAcpAgentCancelInstall } from './acp/agent/cancel-install'
import { register as registerAcpAgentGet } from './acp/agent/get'
import { register as registerAcpAgentInstall } from './acp/agent/install'
import { register as registerAcpAgentInstallPath } from './acp/agent/install-path'
import { register as registerAcpAgentList } from './acp/agent/list'
import { register as registerAcpAgentUninstall } from './acp/agent/uninstall'
import { register as registerAcpAudit } from './acp/audit'
import { register as registerAcpRegistryDistributionTypes } from './acp/registry/distribution-types'
import { register as registerAcpRegistryList } from './acp/registry/list'
import { register as registerAgentCreate } from './agent/create'
import { register as registerAgentDelete } from './agent/delete'
import { register as registerAgentGet } from './agent/get'
import { register as registerAgentList } from './agent/list'
import { register as registerAgentUpdate } from './agent/update'
import { register as registerAutomationArtifactGet } from './automation/artifact/get'
import { register as registerAutomationArtifactList } from './automation/artifact/list'
import { register as registerAutomationArtifacts } from './automation/artifacts'
import { register as registerAutomationCreate } from './automation/create'
import { register as registerAutomationDelete } from './automation/delete'
import { register as registerAutomationDisable } from './automation/disable'
import { register as registerAutomationEnable } from './automation/enable'
import { register as registerAutomationGet } from './automation/get'
import { register as registerAutomationList } from './automation/list'
import { register as registerAutomationRun } from './automation/run'
import { register as registerAutomationRunGet } from './automation/run/get'
import { register as registerAutomationRuns } from './automation/runs'
import { register as registerAutomationUpdate } from './automation/update'
import { register as registerBoardCreate } from './board/create'
import { register as registerBoardDelete } from './board/delete'
import { register as registerBoardList } from './board/list'
import { register as registerBoardUpdate } from './board/update'
import { register as registerChatCancel } from './chat/cancel'
import { register as registerChatMessages } from './chat/messages'
import { register as registerChatQueue } from './chat/queue'
import { register as registerChatQueueAdd } from './chat/queue/add'
import { register as registerChatQueueCancel } from './chat/queue/cancel'
import { register as registerChatQueueReorder } from './chat/queue/reorder'
import { register as registerChatQueueUpdate } from './chat/queue/update'
import { register as registerChatRuntimeSettingsGet } from './chat/runtime-settings/get'
import { register as registerChatRuntimeSettingsSet } from './chat/runtime-settings/set'
import { register as registerChatSessionRollbackLastTurn } from './chat/session/rollback-last-turn'
import { register as registerChatSnapshotRun } from './chat/snapshot/run'
import { register as registerChatSnapshotSession } from './chat/snapshot/session'
import { register as registerChatTraceRun } from './chat/trace/run'
import { register as registerChatTraceSession } from './chat/trace/session'
import { register as registerChronicleAccessibilityEventsList } from './chronicle/accessibility-events/list'
import { register as registerChronicleAccessibilitySnapshotsList } from './chronicle/accessibility-snapshots/list'
import { register as registerChronicleActivityMonitorStatus } from './chronicle/activity-monitor/status'
import { register as registerChronicleActivityPipelineTick } from './chronicle/activity-pipeline/tick'
import { register as registerChronicleActivitySegmentsCrystallize } from './chronicle/activity-segments/crystallize'
import { register as registerChronicleActivitySegmentsGet } from './chronicle/activity-segments/get'
import { register as registerChronicleActivitySegmentsList } from './chronicle/activity-segments/list'
import { register as registerChronicleActivitySegmentsSummarize } from './chronicle/activity-segments/summarize'
import { register as registerChronicleActivitySegmentsTriage } from './chronicle/activity-segments/triage'
import { register as registerChronicleActivitySessionsGet } from './chronicle/activity-sessions/get'
import { register as registerChronicleActivitySessionsList } from './chronicle/activity-sessions/list'
import { register as registerChronicleActivitySessionsSnapshots } from './chronicle/activity-sessions/snapshots'
import { register as registerChronicleActivitySnapshotsGet } from './chronicle/activity-snapshots/get'
import { register as registerChronicleActivitySnapshotsOcr } from './chronicle/activity-snapshots/ocr'
import { register as registerChronicleActivityStorageStats } from './chronicle/activity-storage/stats'
import { register as registerChronicleAudioRawSegmentsList } from './chronicle/audio-raw-segments/list'
import { register as registerChronicleAudioRawSegmentsProcessingResult } from './chronicle/audio-raw-segments/processing-result'
import { register as registerChronicleAudioTranscriptsList } from './chronicle/audio-transcripts/list'
import { register as registerChronicleConfigGet } from './chronicle/config/get'
import { register as registerChronicleConfigSet } from './chronicle/config/set'
import { register as registerChronicleDaemonResources } from './chronicle/daemon/resources'
import { register as registerChronicleDreamRunsList } from './chronicle/dream-runs/list'
import { register as registerChronicleDreamRunsStart } from './chronicle/dream-runs/start'
import { register as registerChronicleEventsList } from './chronicle/events/list'
import { register as registerChronicleKnowledgeCardsCreate } from './chronicle/knowledge-cards/create'
import { register as registerChronicleKnowledgeCardsDelete } from './chronicle/knowledge-cards/delete'
import { register as registerChronicleKnowledgeCardsFiles } from './chronicle/knowledge-cards/files'
import { register as registerChronicleKnowledgeCardsGet } from './chronicle/knowledge-cards/get'
import { register as registerChronicleKnowledgeCardsList } from './chronicle/knowledge-cards/list'
import { register as registerChronicleKnowledgeCardsRestoreVersion } from './chronicle/knowledge-cards/restore-version'
import { register as registerChronicleKnowledgeCardsUpdate } from './chronicle/knowledge-cards/update'
import { register as registerChronicleKnowledgeCardsVersions } from './chronicle/knowledge-cards/versions'
import { register as registerChronicleMemoriesDelete } from './chronicle/memories/delete'
import { register as registerChronicleMemoriesGet } from './chronicle/memories/get'
import { register as registerChronicleMemoriesList } from './chronicle/memories/list'
import { register as registerChronicleMemoriesSearch } from './chronicle/memories/search'
import { register as registerChronicleMemoriesUpdate } from './chronicle/memories/update'
import { register as registerChronicleMemoryStatus } from './chronicle/memory/status'
import { register as registerChronicleMessageSourcesCreate } from './chronicle/message-sources/create'
import { register as registerChronicleMessageSourcesList } from './chronicle/message-sources/list'
import { register as registerChronicleMessageSourcesSync } from './chronicle/message-sources/sync'
import { register as registerChronicleMessageSourcesUpdate } from './chronicle/message-sources/update'
import { register as registerChronicleMessagesList } from './chronicle/messages/list'
import { register as registerChronicleModelResourcesInstall } from './chronicle/model-resources/install'
import { register as registerChronicleModelResourcesInstallAll } from './chronicle/model-resources/install-all'
import { register as registerChronicleModelResourcesList } from './chronicle/model-resources/list'
import { register as registerChronicleModelResourcesReconcile } from './chronicle/model-resources/reconcile'
import { register as registerChronicleModelResourcesVerify } from './chronicle/model-resources/verify'
import { register as registerChroniclePipelineRunsList } from './chronicle/pipeline-runs/list'
import { register as registerChroniclePrivacyBreadcrumbs } from './chronicle/privacy/breadcrumbs'
import { register as registerChroniclePrivacyExport } from './chronicle/privacy/export'
import { register as registerChroniclePrivacyRedact } from './chronicle/privacy/redact'
import { register as registerChronicleSpeakerProfilesList } from './chronicle/speaker-profiles/list'
import { register as registerChronicleSpeakerProfilesUpsert } from './chronicle/speaker-profiles/upsert'
import { register as registerChronicleStatus } from './chronicle/status'
import { register as registerChronicleTimeline } from './chronicle/timeline'
import { register as registerExternalIssueSourceBind } from './external-issue-source/bind'
import { register as registerExternalIssueSourceBindingDelete } from './external-issue-source/binding/delete'
import { register as registerExternalIssueSourceBindingList } from './external-issue-source/binding/list'
import { register as registerExternalIssueSourceBindingUpdate } from './external-issue-source/binding/update'
import { register as registerExternalIssueSourceItemList } from './external-issue-source/item/list'
import { register as registerExternalIssueSourceItemMove } from './external-issue-source/item/move'
import { register as registerExternalIssueSourceList } from './external-issue-source/list'
import { register as registerExternalIssueSourceRefresh } from './external-issue-source/refresh'
import { register as registerExternalIssueSourceRefreshSource } from './external-issue-source/refresh-source'
import { register as registerHealth } from './health'
import { register as registerIssueActivityList } from './issue/activity/list'
import { register as registerIssueCommentAdd } from './issue/comment/add'
import { register as registerIssueCommentDelete } from './issue/comment/delete'
import { register as registerIssueCommentList } from './issue/comment/list'
import { register as registerIssueContextRefAdd } from './issue/context-ref/add'
import { register as registerIssueContextRefRemove } from './issue/context-ref/remove'
import { register as registerIssueCreate } from './issue/create'
import { register as registerIssueDelegate } from './issue/delegate'
import { register as registerIssueDelegation } from './issue/delegation'
import { register as registerIssueDelete } from './issue/delete'
import { register as registerIssueFieldChangeList } from './issue/field-change/list'
import { register as registerIssueGet } from './issue/get'
import { register as registerIssueList } from './issue/list'
import { register as registerIssueMilestoneCreate } from './issue/milestone/create'
import { register as registerIssueMilestoneDelete } from './issue/milestone/delete'
import { register as registerIssueMilestoneList } from './issue/milestone/list'
import { register as registerIssueMilestoneUpdate } from './issue/milestone/update'
import { register as registerIssueMove } from './issue/move'
import { register as registerIssueRelationCreate } from './issue/relation/create'
import { register as registerIssueRelationDelete } from './issue/relation/delete'
import { register as registerIssueRelationList } from './issue/relation/list'
import { register as registerIssueSearch } from './issue/search'
import { register as registerIssueSessions } from './issue/sessions'
import { register as registerIssueStatusCreate } from './issue/status/create'
import { register as registerIssueStatusDelete } from './issue/status/delete'
import { register as registerIssueStatusList } from './issue/status/list'
import { register as registerIssueStatusReorder } from './issue/status/reorder'
import { register as registerIssueStatusUpdate } from './issue/status/update'
import { register as registerIssueUndelegate } from './issue/undelegate'
import { register as registerIssueUpdate } from './issue/update'
import { register as registerIssueAgentSessionActivities } from './issue-agent-session/activities'
import { register as registerIssueAgentSessionRerun } from './issue-agent-session/rerun'
import { register as registerIssueAgentSessionStop } from './issue-agent-session/stop'
import { register as registerLinkPreviewGet } from './link-preview/get'
import { register as registerObservabilityErrorPatterns } from './observability/error-patterns'
import { register as registerObservabilityEvents } from './observability/events'
import { register as registerObservabilityExport } from './observability/export'
import { register as registerObservabilityIncidents } from './observability/incidents'
import { register as registerObservabilityRuntimeSnapshot } from './observability/runtime-snapshot'
import { register as registerOpencodeServerResources } from './opencode/server/resources'
import { register as registerPluginGet } from './plugin/get'
import { register as registerPluginList } from './plugin/list'
import { register as registerPluginSetEnabled } from './plugin/set-enabled'
import { register as registerPreferencesAppGet } from './preferences/app/get'
import { register as registerPreferencesAppSet } from './preferences/app/set'
import { register as registerPreferencesChatGet } from './preferences/chat/get'
import { register as registerPreferencesChatSet } from './preferences/chat/set'
import { register as registerPreferencesCodexGet } from './preferences/codex/get'
import { register as registerPreferencesCodexSet } from './preferences/codex/set'
import { register as registerPreferencesDesktopGet } from './preferences/desktop/get'
import { register as registerPreferencesDesktopSet } from './preferences/desktop/set'
import { register as registerPreferencesJarvisGet } from './preferences/jarvis/get'
import { register as registerPreferencesJarvisSet } from './preferences/jarvis/set'
import { register as registerProfileCustomModels } from './profile/custom-models'
import { register as registerProfileDelete } from './profile/delete'
import { register as registerProfileGet } from './profile/get'
import { register as registerProfileList } from './profile/list'
import { register as registerProfileSet } from './profile/set'
import { register as registerProviderModels } from './provider/models'
import { register as registerRelayServerCreate } from './relay-server/create'
import { register as registerRelayServerDelete } from './relay-server/delete'
import { register as registerRelayServerList } from './relay-server/list'
import { register as registerRelayServerUpdate } from './relay-server/update'
import { register as registerRemoteHostCradleServerConnect } from './remote-host/cradle-server/connect'
import { register as registerRemoteHostCradleServerDisconnect } from './remote-host/cradle-server/disconnect'
import { register as registerRemoteHostCradleServerHealth } from './remote-host/cradle-server/health'
import { register as registerRemoteHostCradleServerWorkspaceList } from './remote-host/cradle-server/workspace/list'
import { register as registerRemoteHostCreate } from './remote-host/create'
import { register as registerRemoteHostDelete } from './remote-host/delete'
import { register as registerRemoteHostList } from './remote-host/list'
import { register as registerRemoteHostUpdate } from './remote-host/update'
import { register as registerSearchChronicle } from './search/chronicle'
import { register as registerSearchThreads } from './search/threads'
import { register as registerSecretDelete } from './secret/delete'
import { register as registerSecretList } from './secret/list'
import { register as registerSessionArchive } from './session/archive'
import { register as registerSessionAwaitCancel } from './session/await-cancel'
import { register as registerSessionAwaitCreate } from './session/await-create'
import { register as registerSessionAwaitGet } from './session/await-get'
import { register as registerSessionAwaitList } from './session/await-list'
import { register as registerSessionAwaitRetryDelivery } from './session/await-retry-delivery'
import { register as registerSessionAwaitSummary } from './session/await-summary'
import { register as registerSessionAwaitTrigger } from './session/await-trigger'
import { register as registerSessionCreate } from './session/create'
import { register as registerSessionDelete } from './session/delete'
import { register as registerSessionExportMarkdown } from './session/export/markdown'
import { register as registerSessionGet } from './session/get'
import { register as registerSessionLinkedIssueGet } from './session/linked-issue/get'
import { register as registerSessionLinkedIssueLink } from './session/linked-issue/link'
import { register as registerSessionLinkedIssueUnlink } from './session/linked-issue/unlink'
import { register as registerSessionList } from './session/list'
import { register as registerSessionUpdate } from './session/update'
import { register as registerSkillCreate } from './skill/create'
import { register as registerSkillDocumentDelete } from './skill/document/delete'
import { register as registerSkillDocumentGet } from './skill/document/get'
import { register as registerSkillDocumentUpdate } from './skill/document/update'
import { register as registerSkillExport } from './skill/export'
import { register as registerSkillImport } from './skill/import'
import { register as registerSkillList } from './skill/list'
import { register as registerSkillSourceCancelFetch } from './skill/source/cancel-fetch'
import { register as registerSkillSourceFetch } from './skill/source/fetch'
import { register as registerSkillSourceImport } from './skill/source/import'
import { register as registerUsageCostDaily } from './usage/cost/daily'
import { register as registerUsageCostSessions } from './usage/cost/sessions'
import { register as registerUsageCostSummary } from './usage/cost/summary'
import { register as registerUsageDaily } from './usage/daily'
import { register as registerUsageSession } from './usage/session'
import { register as registerUsageStats } from './usage/stats'
import { register as registerUsageSummary } from './usage/summary'
import { register as registerWorkflowRuleDelete } from './workflow-rule/delete'
import { register as registerWorkflowRuleGet } from './workflow-rule/get'
import { register as registerWorkflowRuleList } from './workflow-rule/list'
import { register as registerWorkflowRuleSave } from './workflow-rule/save'
import { register as registerWorkspaceCreate } from './workspace/create'
import { register as registerWorkspaceDelete } from './workspace/delete'
import { register as registerWorkspaceDiffsAgentFixArtifact } from './workspace/diffs/agent-fix/artifact'
import { register as registerWorkspaceDiffsAgentFixCancel } from './workspace/diffs/agent-fix/cancel'
import { register as registerWorkspaceDiffsAgentFixCreate } from './workspace/diffs/agent-fix/create'
import { register as registerWorkspaceDiffsAgentFixDelete } from './workspace/diffs/agent-fix/delete'
import { register as registerWorkspaceDiffsAgentFixRerun } from './workspace/diffs/agent-fix/rerun'
import { register as registerWorkspaceDiffsAgentFixStart } from './workspace/diffs/agent-fix/start'
import { register as registerWorkspaceDiffsBranchCompare } from './workspace/diffs/branch-compare'
import { register as registerWorkspaceDiffsClose } from './workspace/diffs/close'
import { register as registerWorkspaceDiffsCommit } from './workspace/diffs/commit'
import { register as registerWorkspaceDiffsCommitPlanApply } from './workspace/diffs/commit-plan/apply'
import { register as registerWorkspaceDiffsCommitPlanUpdate } from './workspace/diffs/commit-plan/update'
import { register as registerWorkspaceDiffsFileViewed } from './workspace/diffs/file/viewed'
import { register as registerWorkspaceDiffsGet } from './workspace/diffs/get'
import { register as registerWorkspaceDiffsGuideCancel } from './workspace/diffs/guide/cancel'
import { register as registerWorkspaceDiffsGuideGenerate } from './workspace/diffs/guide/generate'
import { register as registerWorkspaceDiffsList } from './workspace/diffs/list'
import { register as registerWorkspaceDiffsLocalWorkingTree } from './workspace/diffs/local-working-tree'
import { register as registerWorkspaceDiffsPreferencesSet } from './workspace/diffs/preferences/set'
import { register as registerWorkspaceDiffsReadiness } from './workspace/diffs/readiness'
import { register as registerWorkspaceDiffsRefresh } from './workspace/diffs/refresh'
import { register as registerWorkspaceDiffsSubmit } from './workspace/diffs/submit'
import { register as registerWorkspaceDiffsThreadComment } from './workspace/diffs/thread/comment'
import { register as registerWorkspaceDiffsThreadCreate } from './workspace/diffs/thread/create'
import { register as registerWorkspaceDiffsThreadReaction } from './workspace/diffs/thread/reaction'
import { register as registerWorkspaceDiffsThreadResolve } from './workspace/diffs/thread/resolve'
import { register as registerWorkspaceFileCreate } from './workspace/file/create'
import { register as registerWorkspaceFileRead } from './workspace/file/read'
import { register as registerWorkspaceFileRename } from './workspace/file/rename'
import { register as registerWorkspaceFileWrite } from './workspace/file/write'
import { register as registerWorkspaceFiles } from './workspace/files'
import { register as registerWorkspaceFolderCreate } from './workspace/folder/create'
import { register as registerWorkspaceGet } from './workspace/get'
import { register as registerWorkspaceGitBranchCreate } from './workspace/git/branch/create'
import { register as registerWorkspaceGitBranches } from './workspace/git/branches'
import { register as registerWorkspaceGitCheckout } from './workspace/git/checkout'
import { register as registerWorkspaceGitDiff } from './workspace/git/diff'
import { register as registerWorkspaceGitFetch } from './workspace/git/fetch'
import { register as registerWorkspaceGitGraph } from './workspace/git/graph'
import { register as registerWorkspaceGitRepositories } from './workspace/git/repositories'
import { register as registerWorkspaceGitStatus } from './workspace/git/status'
import { register as registerWorkspaceImport } from './workspace/import'
import { register as registerWorkspaceInspect } from './workspace/inspect'
import { register as registerWorkspaceList } from './workspace/list'
import { register as registerWorkspaceMigrate } from './workspace/migrate'
import { register as registerWorkspaceMultiFolderCreate } from './workspace/multi-folder/create'
import { register as registerWorkspaceMultiFolderImport } from './workspace/multi-folder/import'
import { register as registerWorkspaceResolve } from './workspace/resolve'
import { register as registerWorkspaceUpdate } from './workspace/update'

export function registerGeneratedCommands(program: Command): void {
  registerAcpAgentCancelInstall(program)
  registerAcpAgentGet(program)
  registerAcpAgentInstall(program)
  registerAcpAgentInstallPath(program)
  registerAcpAgentList(program)
  registerAcpAgentUninstall(program)
  registerAcpAudit(program)
  registerAcpRegistryDistributionTypes(program)
  registerAcpRegistryList(program)
  registerAgentCreate(program)
  registerAgentDelete(program)
  registerAgentGet(program)
  registerAgentList(program)
  registerAgentUpdate(program)
  registerAutomationArtifactGet(program)
  registerAutomationArtifactList(program)
  registerAutomationArtifacts(program)
  registerAutomationCreate(program)
  registerAutomationDelete(program)
  registerAutomationDisable(program)
  registerAutomationEnable(program)
  registerAutomationGet(program)
  registerAutomationList(program)
  registerAutomationRun(program)
  registerAutomationRunGet(program)
  registerAutomationRuns(program)
  registerAutomationUpdate(program)
  registerBoardCreate(program)
  registerBoardDelete(program)
  registerBoardList(program)
  registerBoardUpdate(program)
  registerChatCancel(program)
  registerChatMessages(program)
  registerChatQueue(program)
  registerChatQueueAdd(program)
  registerChatQueueCancel(program)
  registerChatQueueReorder(program)
  registerChatQueueUpdate(program)
  registerChatRuntimeSettingsGet(program)
  registerChatRuntimeSettingsSet(program)
  registerChatSessionRollbackLastTurn(program)
  registerChatSnapshotRun(program)
  registerChatSnapshotSession(program)
  registerChatTraceRun(program)
  registerChatTraceSession(program)
  registerChronicleAccessibilityEventsList(program)
  registerChronicleAccessibilitySnapshotsList(program)
  registerChronicleActivityMonitorStatus(program)
  registerChronicleActivityPipelineTick(program)
  registerChronicleActivitySegmentsCrystallize(program)
  registerChronicleActivitySegmentsGet(program)
  registerChronicleActivitySegmentsList(program)
  registerChronicleActivitySegmentsSummarize(program)
  registerChronicleActivitySegmentsTriage(program)
  registerChronicleActivitySessionsGet(program)
  registerChronicleActivitySessionsList(program)
  registerChronicleActivitySessionsSnapshots(program)
  registerChronicleActivitySnapshotsGet(program)
  registerChronicleActivitySnapshotsOcr(program)
  registerChronicleActivityStorageStats(program)
  registerChronicleAudioRawSegmentsList(program)
  registerChronicleAudioRawSegmentsProcessingResult(program)
  registerChronicleAudioTranscriptsList(program)
  registerChronicleConfigGet(program)
  registerChronicleConfigSet(program)
  registerChronicleDaemonResources(program)
  registerChronicleDreamRunsList(program)
  registerChronicleDreamRunsStart(program)
  registerChronicleEventsList(program)
  registerChronicleKnowledgeCardsCreate(program)
  registerChronicleKnowledgeCardsDelete(program)
  registerChronicleKnowledgeCardsFiles(program)
  registerChronicleKnowledgeCardsGet(program)
  registerChronicleKnowledgeCardsList(program)
  registerChronicleKnowledgeCardsRestoreVersion(program)
  registerChronicleKnowledgeCardsUpdate(program)
  registerChronicleKnowledgeCardsVersions(program)
  registerChronicleMemoriesDelete(program)
  registerChronicleMemoriesGet(program)
  registerChronicleMemoriesList(program)
  registerChronicleMemoriesSearch(program)
  registerChronicleMemoriesUpdate(program)
  registerChronicleMemoryStatus(program)
  registerChronicleMessageSourcesCreate(program)
  registerChronicleMessageSourcesList(program)
  registerChronicleMessageSourcesSync(program)
  registerChronicleMessageSourcesUpdate(program)
  registerChronicleMessagesList(program)
  registerChronicleModelResourcesInstall(program)
  registerChronicleModelResourcesInstallAll(program)
  registerChronicleModelResourcesList(program)
  registerChronicleModelResourcesReconcile(program)
  registerChronicleModelResourcesVerify(program)
  registerChroniclePipelineRunsList(program)
  registerChroniclePrivacyBreadcrumbs(program)
  registerChroniclePrivacyExport(program)
  registerChroniclePrivacyRedact(program)
  registerChronicleSpeakerProfilesList(program)
  registerChronicleSpeakerProfilesUpsert(program)
  registerChronicleStatus(program)
  registerChronicleTimeline(program)
  registerExternalIssueSourceBind(program)
  registerExternalIssueSourceBindingDelete(program)
  registerExternalIssueSourceBindingList(program)
  registerExternalIssueSourceBindingUpdate(program)
  registerExternalIssueSourceItemList(program)
  registerExternalIssueSourceItemMove(program)
  registerExternalIssueSourceList(program)
  registerExternalIssueSourceRefresh(program)
  registerExternalIssueSourceRefreshSource(program)
  registerHealth(program)
  registerIssueActivityList(program)
  registerIssueCommentAdd(program)
  registerIssueCommentDelete(program)
  registerIssueCommentList(program)
  registerIssueContextRefAdd(program)
  registerIssueContextRefRemove(program)
  registerIssueCreate(program)
  registerIssueDelegate(program)
  registerIssueDelegation(program)
  registerIssueDelete(program)
  registerIssueFieldChangeList(program)
  registerIssueGet(program)
  registerIssueList(program)
  registerIssueMilestoneCreate(program)
  registerIssueMilestoneDelete(program)
  registerIssueMilestoneList(program)
  registerIssueMilestoneUpdate(program)
  registerIssueMove(program)
  registerIssueRelationCreate(program)
  registerIssueRelationDelete(program)
  registerIssueRelationList(program)
  registerIssueSearch(program)
  registerIssueSessions(program)
  registerIssueStatusCreate(program)
  registerIssueStatusDelete(program)
  registerIssueStatusList(program)
  registerIssueStatusReorder(program)
  registerIssueStatusUpdate(program)
  registerIssueUndelegate(program)
  registerIssueUpdate(program)
  registerIssueAgentSessionActivities(program)
  registerIssueAgentSessionRerun(program)
  registerIssueAgentSessionStop(program)
  registerLinkPreviewGet(program)
  registerObservabilityErrorPatterns(program)
  registerObservabilityEvents(program)
  registerObservabilityExport(program)
  registerObservabilityIncidents(program)
  registerObservabilityRuntimeSnapshot(program)
  registerOpencodeServerResources(program)
  registerPluginGet(program)
  registerPluginList(program)
  registerPluginSetEnabled(program)
  registerPreferencesAppGet(program)
  registerPreferencesAppSet(program)
  registerPreferencesChatGet(program)
  registerPreferencesChatSet(program)
  registerPreferencesCodexGet(program)
  registerPreferencesCodexSet(program)
  registerPreferencesDesktopGet(program)
  registerPreferencesDesktopSet(program)
  registerPreferencesJarvisGet(program)
  registerPreferencesJarvisSet(program)
  registerProfileCustomModels(program)
  registerProfileDelete(program)
  registerProfileGet(program)
  registerProfileList(program)
  registerProfileSet(program)
  registerProviderModels(program)
  registerRelayServerCreate(program)
  registerRelayServerDelete(program)
  registerRelayServerList(program)
  registerRelayServerUpdate(program)
  registerRemoteHostCradleServerConnect(program)
  registerRemoteHostCradleServerDisconnect(program)
  registerRemoteHostCradleServerHealth(program)
  registerRemoteHostCradleServerWorkspaceList(program)
  registerRemoteHostCreate(program)
  registerRemoteHostDelete(program)
  registerRemoteHostList(program)
  registerRemoteHostUpdate(program)
  registerSearchChronicle(program)
  registerSearchThreads(program)
  registerSecretDelete(program)
  registerSecretList(program)
  registerSessionArchive(program)
  registerSessionAwaitCancel(program)
  registerSessionAwaitCreate(program)
  registerSessionAwaitGet(program)
  registerSessionAwaitList(program)
  registerSessionAwaitRetryDelivery(program)
  registerSessionAwaitSummary(program)
  registerSessionAwaitTrigger(program)
  registerSessionCreate(program)
  registerSessionDelete(program)
  registerSessionExportMarkdown(program)
  registerSessionGet(program)
  registerSessionLinkedIssueGet(program)
  registerSessionLinkedIssueLink(program)
  registerSessionLinkedIssueUnlink(program)
  registerSessionList(program)
  registerSessionUpdate(program)
  registerSkillCreate(program)
  registerSkillDocumentDelete(program)
  registerSkillDocumentGet(program)
  registerSkillDocumentUpdate(program)
  registerSkillExport(program)
  registerSkillImport(program)
  registerSkillList(program)
  registerSkillSourceCancelFetch(program)
  registerSkillSourceFetch(program)
  registerSkillSourceImport(program)
  registerUsageCostDaily(program)
  registerUsageCostSessions(program)
  registerUsageCostSummary(program)
  registerUsageDaily(program)
  registerUsageSession(program)
  registerUsageStats(program)
  registerUsageSummary(program)
  registerWorkflowRuleDelete(program)
  registerWorkflowRuleGet(program)
  registerWorkflowRuleList(program)
  registerWorkflowRuleSave(program)
  registerWorkspaceCreate(program)
  registerWorkspaceDelete(program)
  registerWorkspaceDiffsAgentFixArtifact(program)
  registerWorkspaceDiffsAgentFixCancel(program)
  registerWorkspaceDiffsAgentFixCreate(program)
  registerWorkspaceDiffsAgentFixDelete(program)
  registerWorkspaceDiffsAgentFixRerun(program)
  registerWorkspaceDiffsAgentFixStart(program)
  registerWorkspaceDiffsBranchCompare(program)
  registerWorkspaceDiffsClose(program)
  registerWorkspaceDiffsCommit(program)
  registerWorkspaceDiffsCommitPlanApply(program)
  registerWorkspaceDiffsCommitPlanUpdate(program)
  registerWorkspaceDiffsFileViewed(program)
  registerWorkspaceDiffsGet(program)
  registerWorkspaceDiffsGuideCancel(program)
  registerWorkspaceDiffsGuideGenerate(program)
  registerWorkspaceDiffsList(program)
  registerWorkspaceDiffsLocalWorkingTree(program)
  registerWorkspaceDiffsPreferencesSet(program)
  registerWorkspaceDiffsReadiness(program)
  registerWorkspaceDiffsRefresh(program)
  registerWorkspaceDiffsSubmit(program)
  registerWorkspaceDiffsThreadComment(program)
  registerWorkspaceDiffsThreadCreate(program)
  registerWorkspaceDiffsThreadReaction(program)
  registerWorkspaceDiffsThreadResolve(program)
  registerWorkspaceFileCreate(program)
  registerWorkspaceFileRead(program)
  registerWorkspaceFileRename(program)
  registerWorkspaceFileWrite(program)
  registerWorkspaceFiles(program)
  registerWorkspaceFolderCreate(program)
  registerWorkspaceGet(program)
  registerWorkspaceGitBranchCreate(program)
  registerWorkspaceGitBranches(program)
  registerWorkspaceGitCheckout(program)
  registerWorkspaceGitDiff(program)
  registerWorkspaceGitFetch(program)
  registerWorkspaceGitGraph(program)
  registerWorkspaceGitRepositories(program)
  registerWorkspaceGitStatus(program)
  registerWorkspaceImport(program)
  registerWorkspaceInspect(program)
  registerWorkspaceList(program)
  registerWorkspaceMigrate(program)
  registerWorkspaceMultiFolderCreate(program)
  registerWorkspaceMultiFolderImport(program)
  registerWorkspaceResolve(program)
  registerWorkspaceUpdate(program)
}
