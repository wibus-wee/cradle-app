import type { Command } from 'commander'

import { register as registerChronicleAccessibilityEventsList } from '../chronicle/accessibility-events/list'
import { register as registerChronicleAccessibilitySnapshotsList } from '../chronicle/accessibility-snapshots/list'
import { register as registerChronicleActivityMonitorStatus } from '../chronicle/activity-monitor/status'
import { register as registerChronicleActivityPipelineTick } from '../chronicle/activity-pipeline/tick'
import { register as registerChronicleActivitySegmentsCrystallize } from '../chronicle/activity-segments/crystallize'
import { register as registerChronicleActivitySegmentsGet } from '../chronicle/activity-segments/get'
import { register as registerChronicleActivitySegmentsList } from '../chronicle/activity-segments/list'
import { register as registerChronicleActivitySegmentsSummarize } from '../chronicle/activity-segments/summarize'
import { register as registerChronicleActivitySegmentsTriage } from '../chronicle/activity-segments/triage'
import { register as registerChronicleActivitySessionsGet } from '../chronicle/activity-sessions/get'
import { register as registerChronicleActivitySessionsList } from '../chronicle/activity-sessions/list'
import { register as registerChronicleActivitySessionsSnapshots } from '../chronicle/activity-sessions/snapshots'
import { register as registerChronicleActivitySnapshotsGet } from '../chronicle/activity-snapshots/get'
import { register as registerChronicleActivitySnapshotsOcr } from '../chronicle/activity-snapshots/ocr'
import { register as registerChronicleActivityStorageStats } from '../chronicle/activity-storage/stats'
import { register as registerChronicleAudioRawSegmentsList } from '../chronicle/audio-raw-segments/list'
import { register as registerChronicleAudioRawSegmentsProcessingResult } from '../chronicle/audio-raw-segments/processing-result'
import { register as registerChronicleAudioTranscriptsList } from '../chronicle/audio-transcripts/list'
import { register as registerChronicleConfigGet } from '../chronicle/config/get'
import { register as registerChronicleConfigSet } from '../chronicle/config/set'
import { register as registerChronicleDaemonResources } from '../chronicle/daemon/resources'
import { register as registerChronicleDreamRunsList } from '../chronicle/dream-runs/list'
import { register as registerChronicleDreamRunsStart } from '../chronicle/dream-runs/start'
import { register as registerChronicleEventsList } from '../chronicle/events/list'
import { register as registerChronicleKnowledgeCardsCreate } from '../chronicle/knowledge-cards/create'
import { register as registerChronicleKnowledgeCardsDelete } from '../chronicle/knowledge-cards/delete'
import { register as registerChronicleKnowledgeCardsFiles } from '../chronicle/knowledge-cards/files'
import { register as registerChronicleKnowledgeCardsGet } from '../chronicle/knowledge-cards/get'
import { register as registerChronicleKnowledgeCardsList } from '../chronicle/knowledge-cards/list'
import { register as registerChronicleKnowledgeCardsRestoreVersion } from '../chronicle/knowledge-cards/restore-version'
import { register as registerChronicleKnowledgeCardsUpdate } from '../chronicle/knowledge-cards/update'
import { register as registerChronicleKnowledgeCardsVersions } from '../chronicle/knowledge-cards/versions'
import { register as registerChronicleMemoriesDelete } from '../chronicle/memories/delete'
import { register as registerChronicleMemoriesGet } from '../chronicle/memories/get'
import { register as registerChronicleMemoriesList } from '../chronicle/memories/list'
import { register as registerChronicleMemoriesSearch } from '../chronicle/memories/search'
import { register as registerChronicleMemoriesUpdate } from '../chronicle/memories/update'
import { register as registerChronicleMemoryStatus } from '../chronicle/memory/status'
import { register as registerChronicleMessageSourcesCreate } from '../chronicle/message-sources/create'
import { register as registerChronicleMessageSourcesList } from '../chronicle/message-sources/list'
import { register as registerChronicleMessageSourcesSync } from '../chronicle/message-sources/sync'
import { register as registerChronicleMessageSourcesUpdate } from '../chronicle/message-sources/update'
import { register as registerChronicleMessagesList } from '../chronicle/messages/list'
import { register as registerChronicleModelResourcesInstall } from '../chronicle/model-resources/install'
import { register as registerChronicleModelResourcesInstallAll } from '../chronicle/model-resources/install-all'
import { register as registerChronicleModelResourcesList } from '../chronicle/model-resources/list'
import { register as registerChronicleModelResourcesReconcile } from '../chronicle/model-resources/reconcile'
import { register as registerChronicleModelResourcesVerify } from '../chronicle/model-resources/verify'
import { register as registerChroniclePipelineRunsList } from '../chronicle/pipeline-runs/list'
import { register as registerChroniclePrivacyBreadcrumbs } from '../chronicle/privacy/breadcrumbs'
import { register as registerChroniclePrivacyExport } from '../chronicle/privacy/export'
import { register as registerChroniclePrivacyRedact } from '../chronicle/privacy/redact'
import { register as registerChronicleSpeakerProfilesList } from '../chronicle/speaker-profiles/list'
import { register as registerChronicleSpeakerProfilesUpsert } from '../chronicle/speaker-profiles/upsert'
import { register as registerChronicleStatus } from '../chronicle/status'
import { register as registerChronicleTimeline } from '../chronicle/timeline'

export function registerGeneratedCommands(program: Command): void {
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
}
