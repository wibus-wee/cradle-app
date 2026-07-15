import { Elysia, t } from 'elysia'

import { getDaemonResources } from './daemon-manager'
import { ChronicleModel } from './model'
import * as Chronicle from './service'

function encodeSseEvent(event: Chronicle.ChronicleRealtimeEventEntry): Uint8Array {
  return new TextEncoder().encode(`id: ${event.createdAtUnix}\nevent: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`)
}

export function createChronicleModule(downloadCenter?: Chronicle.ModelResourceDownloadCenter) {
  return new Elysia({ prefix: '/chronicle' })
  .get('/config', () => Chronicle.getConfig(), {
    detail: {
      'summary': 'Get Chronicle daemon configuration',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'config', 'get'] },
    },
    response: { 200: ChronicleModel.config },
  })
  .post('/summarize', ({ body }) => Chronicle.summarize(body), {
    detail: { summary: 'Generate LLM summary from Chronicle prompt', tags: ['chronicle'] },
    body: ChronicleModel.summarizeBody,
    response: { 200: ChronicleModel.summarizeResponse },
  })
  .post('/snapshots', ({ body }) => Chronicle.recordSnapshot(body), {
    detail: { summary: 'Ingest a Chronicle snapshot report', tags: ['chronicle'] },
    body: ChronicleModel.snapshotReportBody,
    response: { 200: ChronicleModel.snapshotIngestResponse },
  })
  .post('/memories', ({ body }) => Chronicle.recordMemory(body), {
    detail: { summary: 'Ingest a Chronicle memory report', tags: ['chronicle'] },
    body: ChronicleModel.memoryReportBody,
  })
  .put('/config', ({ body }) => Chronicle.updateConfig(body), {
    detail: {
      'summary': 'Update Chronicle daemon configuration',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'config', 'set'] },
    },
    body: ChronicleModel.config,
    response: { 200: ChronicleModel.config },
  })
  .get('/status', () => Chronicle.getStatus(), {
    detail: {
      'summary': 'Get Chronicle daemon status',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'status'] },
    },
    response: { 200: ChronicleModel.status },
  })
  .get('/daemon/resources', () => getDaemonResources(), {
    detail: {
      'summary': 'Get Chronicle daemon process resource usage',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'daemon', 'resources'] },
    },
    response: { 200: ChronicleModel.daemonResources },
  })
  .get('/model-resources', () => Chronicle.getModelResources(), {
    detail: {
      'summary': 'Get Chronicle local model resource status',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'model-resources', 'list'] },
    },
    response: { 200: t.Array(ChronicleModel.modelResource) },
  })
  .post('/model-resources/reconcile', () => Chronicle.reconcileModelResources(), {
    detail: {
      'summary': 'Reconcile Chronicle local model resources',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'model-resources', 'reconcile'] },
    },
    response: { 200: t.Array(ChronicleModel.modelResource) },
  })
  .post('/model-resources/install-all', () => Chronicle.installAllModelResources(downloadCenter), {
    detail: {
      'summary': 'Install all Chronicle model resources from manifests',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'model-resources', 'install-all'] },
    },
    response: { 200: t.Array(ChronicleModel.modelResource) },
  })
  .post('/model-resources/:category/verify', ({ params }) => Chronicle.verifyModelResource(params.category), {
    detail: {
      'summary': 'Verify a Chronicle local model resource',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'model-resources', 'verify'] },
    },
    params: ChronicleModel.modelResourceCategoryParams,
    response: { 200: ChronicleModel.modelResource },
  })
  .post('/model-resources/:category/install', ({ params, body }) => Chronicle.installModelResource(params.category, body, downloadCenter), {
    detail: {
      'summary': 'Install a Chronicle local model resource',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'model-resources', 'install'] },
    },
    params: ChronicleModel.modelResourceCategoryParams,
    body: ChronicleModel.modelResourceInstallBody,
    response: { 200: ChronicleModel.modelResource },
  })
  .delete('/model-resources/:category', ({ params }) => Chronicle.removeModelResource(params.category), {
    detail: { summary: 'Remove a Chronicle local model resource', tags: ['chronicle'] },
    params: ChronicleModel.modelResourceCategoryParams,
    response: { 200: ChronicleModel.modelResource },
  })
  .get('/message-sources', () => Chronicle.listMessageSources(), {
    detail: {
      'summary': 'List Chronicle message sources',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'message-sources', 'list'] },
    },
    response: { 200: t.Array(ChronicleModel.messageSource) },
  })
  .post('/message-sources', ({ body }) => Chronicle.createMessageSource(body), {
    detail: {
      'summary': 'Create a Chronicle message source',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'message-sources', 'create'] },
    },
    body: ChronicleModel.messageSourceBody,
    response: { 200: ChronicleModel.messageSource },
  })
  .patch('/message-sources/:sourceId', ({ params, body }) => Chronicle.updateMessageSource(params.sourceId, body), {
    detail: {
      'summary': 'Update a Chronicle message source',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'message-sources', 'update'] },
    },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    body: ChronicleModel.messageSourcePatchBody,
    response: { 200: ChronicleModel.messageSource },
  })
  .delete('/message-sources/:sourceId', ({ params }) => Chronicle.deleteMessageSource(params.sourceId), {
    detail: { summary: 'Delete a Chronicle message source', tags: ['chronicle'] },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .post('/message-sources/:sourceId/sync', ({ params }) => Chronicle.syncSlackSource(params.sourceId), {
    detail: {
      'summary': 'Synchronize a Chronicle Slack source',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'message-sources', 'sync'] },
    },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.slackSyncResponse },
  })
  .post('/message-sources/:sourceId/slack/events', async ({ params, request, headers }) => {
    const result = await Chronicle.handleSlackEvents(params.sourceId, {
      rawBody: await request.text(),
      signature: headers['x-slack-signature'] ?? null,
      timestamp: headers['x-slack-request-timestamp'] ?? null,
    })
    if (result.challenge) {
      return new Response(result.challenge, {
        headers: { 'content-type': 'text/plain' },
      })
    }
    return new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    })
  }, {
    detail: { summary: 'Receive Slack Events API callbacks for a Chronicle source', tags: ['chronicle'] },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    parse: 'none',
  })
  .get('/messages', ({ query }) => Chronicle.listMessages(query.limit), {
    detail: {
      'summary': 'List Chronicle message events',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'messages', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 50 })) }),
    response: { 200: t.Array(ChronicleModel.messageEntry) },
  })
  .get('/audio-transcripts', ({ query }) => Chronicle.listAudioTranscripts(query.limit), {
    detail: {
      'summary': 'List Chronicle audio transcripts',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'audio-transcripts', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.audioTranscript) },
  })
  .post('/audio-transcripts', ({ body }) => Chronicle.recordAudioTranscript(body), {
    detail: { summary: 'Ingest a Chronicle audio transcript report', tags: ['chronicle'] },
    body: ChronicleModel.audioTranscriptReportBody,
    response: { 200: ChronicleModel.audioTranscript },
  })
  .get('/speaker-profiles', () => Chronicle.listSpeakerProfiles(), {
    detail: {
      'summary': 'List Chronicle speaker profiles learned from transcripts',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'speaker-profiles', 'list'] },
    },
    response: { 200: t.Array(ChronicleModel.speakerProfile) },
  })
  .post('/speaker-profiles', ({ body }) => Chronicle.upsertSpeakerProfile(body), {
    detail: {
      'summary': 'Create or update a Chronicle speaker profile',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'speaker-profiles', 'upsert'] },
    },
    body: ChronicleModel.speakerProfileBody,
    response: { 200: ChronicleModel.speakerProfile },
  })
  .get('/audio-raw-segments', ({ query }) => Chronicle.listAudioRawSegments(query.limit), {
    detail: {
      'summary': 'List Chronicle raw audio segment artifacts',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'audio-raw-segments', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.audioRawSegment) },
  })
  .post('/audio-raw-segments', ({ body }) => Chronicle.recordAudioRawSegment(body), {
    detail: { summary: 'Ingest a Chronicle raw audio segment artifact report', tags: ['chronicle'] },
    body: ChronicleModel.audioRawSegmentReportBody,
    response: { 200: ChronicleModel.audioRawSegment },
  })
  .post('/audio-raw-segments/:sourceId/processing-result', ({ params, body }) => Chronicle.recordAudioRawSegmentProcessingResult(params.sourceId, body), {
    detail: {
      'summary': 'Record Chronicle raw audio processing results',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'audio-raw-segments', 'processing-result'] },
    },
    params: t.Object({ sourceId: t.String({ minLength: 1 }) }),
    body: ChronicleModel.audioRawSegmentProcessingResultBody,
    response: { 200: ChronicleModel.audioRawSegment },
  })
  .get('/accessibility-snapshots', ({ query }) => Chronicle.listAccessibilitySnapshots(query.limit), {
    detail: {
      'summary': 'List Chronicle accessibility evidence snapshots',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'accessibility-snapshots', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.accessibilitySnapshot) },
  })
  .get('/accessibility-events', ({ query }) => Chronicle.listAccessibilityEvents(query.limit), {
    detail: {
      'summary': 'List Chronicle accessibility observer events',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'accessibility-events', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 50 })) }),
    response: { 200: t.Array(ChronicleModel.accessibilityEvent) },
  })
  .post('/accessibility-events', ({ body }) => Chronicle.recordAccessibilityEvent(body), {
    detail: { summary: 'Ingest a Chronicle accessibility observer event', tags: ['chronicle'] },
    body: ChronicleModel.accessibilityEventReportBody,
    response: { 200: ChronicleModel.accessibilityEvent },
  })
  .get('/activity-segments', ({ query }) => Chronicle.listActivitySegments(query.limit), {
    detail: {
      'summary': 'List Chronicle activity segments',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-segments', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.activitySegment) },
  })
  .get('/activity-sessions', ({ query }) => Chronicle.listActivitySessions(query.limit), {
    detail: {
      'summary': 'List Chronicle activity sessions',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-sessions', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.activitySession) },
  })
  .get('/activity-sessions/:sessionId', ({ params }) => Chronicle.getActivitySession(params.sessionId), {
    detail: {
      'summary': 'Get a Chronicle activity session',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-sessions', 'get'] },
    },
    params: t.Object({ sessionId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.activitySessionDetail },
  })
  .get('/activity-sessions/:sessionId/snapshots', ({ params }) => Chronicle.listActivitySessionSnapshots(params.sessionId), {
    detail: {
      'summary': 'List snapshots linked to a Chronicle activity session',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-sessions', 'snapshots'] },
    },
    params: t.Object({ sessionId: t.String({ minLength: 1 }) }),
    response: { 200: t.Array(ChronicleModel.activitySnapshot) },
  })
  .get('/activity-snapshots/:snapshotId', ({ params }) => Chronicle.getActivitySnapshot(params.snapshotId), {
    detail: {
      'summary': 'Get a Chronicle activity snapshot',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-snapshots', 'get'] },
    },
    params: t.Object({ snapshotId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.activitySnapshot },
  })
  .get('/activity-snapshots/:snapshotId/ocr', ({ params }) => Chronicle.getActivitySnapshotOcr(params.snapshotId), {
    detail: {
      'summary': 'Get Chronicle activity snapshot OCR metadata',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-snapshots', 'ocr'] },
    },
    params: t.Object({ snapshotId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.activitySnapshotOcr },
  })
  .get('/activity-segments/:segmentId', ({ params }) => Chronicle.getActivitySegment(params.segmentId), {
    detail: {
      'summary': 'Get a Chronicle activity segment',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-segments', 'get'] },
    },
    params: t.Object({ segmentId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.activitySegment },
  })
  .post('/activity-segments/:segmentId/triage', ({ params }) => Chronicle.triageActivitySegment(params.segmentId), {
    detail: {
      'summary': 'Run Chronicle activity segment triage',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-segments', 'triage'] },
    },
    params: t.Object({ segmentId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.activityPipelineAction },
  })
  .post('/activity-segments/:segmentId/summarize', ({ params }) => Chronicle.summarizeActivitySegment(params.segmentId), {
    detail: {
      'summary': 'Run Chronicle activity segment summarization',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-segments', 'summarize'] },
    },
    params: t.Object({ segmentId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.activityPipelineAction },
  })
  .post('/activity-segments/:segmentId/crystallize', ({ params }) => Chronicle.crystallizeActivitySegment(params.segmentId), {
    detail: {
      'summary': 'Run Chronicle activity segment knowledge crystallization',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-segments', 'crystallize'] },
    },
    params: t.Object({ segmentId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.activityPipelineAction },
  })
  .post('/activity-pipeline/tick', () => Chronicle.runActivityPipelineTick(), {
    detail: {
      'summary': 'Run one Chronicle automatic activity pipeline tick',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-pipeline', 'tick'] },
    },
    response: { 200: ChronicleModel.activityPipelineTickResponse },
  })
  .get('/activity-monitor/status', () => Chronicle.getActivityMonitorStatus(), {
    detail: {
      'summary': 'Get Chronicle activity monitor status',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-monitor', 'status'] },
    },
    response: { 200: ChronicleModel.activityMonitorStatus },
  })
  .get('/activity-storage/stats', () => Chronicle.getActivityStorageStats(), {
    detail: {
      'summary': 'Get Chronicle activity storage stats',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'activity-storage', 'stats'] },
    },
    response: { 200: ChronicleModel.activityStorageStats },
  })
  .get('/memory/status', () => Chronicle.getMemoryStatus(), {
    detail: {
      'summary': 'Get Chronicle memory status',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'memory', 'status'] },
    },
    response: { 200: ChronicleModel.memoryStatus },
  })
  .get('/pipeline-runs', ({ query }) => Chronicle.listPipelineRuns(query.limit), {
    detail: {
      'summary': 'List Chronicle activity pipeline runs',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'pipeline-runs', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.pipelineRun) },
  })
  .get('/knowledge-cards', ({ query }) => Chronicle.listKnowledgeCards({
    limit: query.limit,
    dimension: query.dimension,
    cardType: query.type,
    includeDeleted: query.includeDeleted,
  }), {
    detail: {
      'summary': 'List Chronicle knowledge cards',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'knowledge-cards', 'list'] },
    },
    query: ChronicleModel.knowledgeCardsQuery,
    response: { 200: t.Array(ChronicleModel.knowledgeCard) },
  })
  .post('/knowledge-cards', ({ body }) => Chronicle.createKnowledgeCard(body), {
    detail: {
      'summary': 'Create a Chronicle knowledge card',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'knowledge-cards', 'create'] },
    },
    body: ChronicleModel.knowledgeCardMutationBody,
    response: { 200: ChronicleModel.knowledgeCard },
  })
  .get('/knowledge-cards/:knowledgeId/versions', ({ params }) => Chronicle.listKnowledgeVersions(params.knowledgeId), {
    detail: {
      'summary': 'List Chronicle knowledge card versions',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'knowledge-cards', 'versions'] },
    },
    params: t.Object({ knowledgeId: t.String({ minLength: 1 }) }),
    response: { 200: t.Array(ChronicleModel.knowledgeVersion) },
  })
  .get('/knowledge-cards/:knowledgeId/files', ({ params }) => Chronicle.listKnowledgeFiles(params.knowledgeId), {
    detail: {
      'summary': 'List Chronicle knowledge card evidence files',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'knowledge-cards', 'files'] },
    },
    params: t.Object({ knowledgeId: t.String({ minLength: 1 }) }),
    response: { 200: t.Array(ChronicleModel.knowledgeFile) },
  })
  .post('/knowledge-cards/:knowledgeId/versions/restore', ({ params, body }) => Chronicle.restoreKnowledgeVersion(params.knowledgeId, body.version), {
    detail: {
      'summary': 'Restore a Chronicle knowledge card version',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'knowledge-cards', 'restore-version'] },
    },
    params: t.Object({ knowledgeId: t.String({ minLength: 1 }) }),
    body: ChronicleModel.knowledgeVersionRestoreBody,
    response: { 200: ChronicleModel.knowledgeCard },
  })
  .get('/knowledge-cards/:knowledgeId', ({ params }) => Chronicle.getKnowledgeCard(params.knowledgeId), {
    detail: {
      'summary': 'Get a Chronicle knowledge card',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'knowledge-cards', 'get'] },
    },
    params: t.Object({ knowledgeId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.knowledgeCard },
  })
  .patch('/knowledge-cards/:knowledgeId', ({ params, body }) => Chronicle.updateKnowledgeCard(params.knowledgeId, body), {
    detail: {
      'summary': 'Update a Chronicle knowledge card',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'knowledge-cards', 'update'] },
    },
    params: t.Object({ knowledgeId: t.String({ minLength: 1 }) }),
    body: ChronicleModel.knowledgeCardPatchBody,
    response: { 200: ChronicleModel.knowledgeCard },
  })
  .delete('/knowledge-cards/:knowledgeId', ({ params }) => Chronicle.deleteKnowledgeCard(params.knowledgeId), {
    detail: {
      'summary': 'Delete a Chronicle knowledge card',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'knowledge-cards', 'delete'] },
    },
    params: t.Object({ knowledgeId: t.String({ minLength: 1 }) }),
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .get('/dream-runs', ({ query }) => Chronicle.listDreamRuns(query.limit), {
    detail: {
      'summary': 'List Chronicle dream merge runs',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'dream-runs', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.dreamRun) },
  })
  .post('/dream-runs', ({ body }) => Chronicle.startDreamRun(body), {
    detail: {
      'summary': 'Start a Chronicle dream merge run',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'dream-runs', 'start'] },
    },
    body: ChronicleModel.dreamStartBody,
    response: { 200: ChronicleModel.dreamRun },
  })
  .get('/timeline', ({ query }) => Chronicle.getTimeline(query.limit), {
    detail: {
      'summary': 'Get recent Chronicle captures',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'timeline'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 50 })) }),
    response: { 200: t.Array(ChronicleModel.timelineEntry) },
  })
  .get('/events', ({ query }) => Chronicle.listRealtimeEvents(query), {
    detail: {
      'summary': 'List Chronicle realtime-compatible events',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'events', 'list'] },
    },
    query: ChronicleModel.realtimeEventsQuery,
    response: { 200: t.Array(ChronicleModel.realtimeEvent) },
  })
  .get('/events/stream', ({ query }) => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let cursor = query.after ?? 0
        const sentIds = new Set<string>()
        const sendEvents = () => {
          const events = Chronicle.listRealtimeEvents({
            limit: query.limit,
            after: cursor === 0 ? cursor : Math.max(cursor - 1, 0),
          })
          let sentCount = 0
          for (const event of events) {
            if (sentIds.has(event.id)) {
              continue
            }
            sentIds.add(event.id)
            cursor = Math.max(cursor, event.createdAtUnix)
            controller.enqueue(encodeSseEvent(event))
            sentCount += 1
          }
          return sentCount
        }
        sendEvents()
        if (query.once) {
          controller.close()
          return
        }
        const interval = setInterval(() => {
          try {
            const sentCount = sendEvents()
            if (sentCount === 0) {
              controller.enqueue(encoder.encode(': keepalive\n\n'))
            }
          }
          catch {
            clearInterval(interval)
          }
        }, query.intervalMs ?? 1000)
      },
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }, {
    detail: { summary: 'SSE stream of Chronicle realtime-compatible events', tags: ['chronicle'] },
    query: ChronicleModel.realtimeEventsStreamQuery,
  })
  .get('/snapshots/:snapshotId/frame', ({ params }) => Chronicle.getFrameImageBySnapshot(params.snapshotId), {
    detail: { summary: 'Get a captured frame image by snapshot id', tags: ['chronicle'] },
  })
  .get('/frame/:displayId/:segment/:frame', ({ params }) => Chronicle.getFrameImage(`${params.displayId}/${params.segment}`, params.frame), {
    detail: { summary: 'Get a captured frame image', tags: ['chronicle'] },
  })
  .get('/memories', ({ query }) => Chronicle.getMemories(query.limit), {
    detail: {
      'summary': 'Get Chronicle AI memories/summaries',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'memories', 'list'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 20 })) }),
    response: { 200: t.Array(ChronicleModel.memoryEntry) },
  })
  .get('/memories/search', ({ query }) => Chronicle.searchMemories(query.q, query.limit), {
    detail: {
      'summary': 'Search Chronicle memories',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'memories', 'search'] },
    },
    query: t.Object({
      q: t.String({ minLength: 1 }),
      limit: t.Optional(t.Number({ default: 20 })),
    }),
    response: { 200: t.Array(ChronicleModel.memoryEntry) },
  })
  .get('/memories/:memoryId', ({ params }) => Chronicle.getMemory(params.memoryId), {
    detail: {
      'summary': 'Get a Chronicle memory',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'memories', 'get'] },
    },
    params: t.Object({ memoryId: t.String({ minLength: 1 }) }),
    response: { 200: ChronicleModel.memoryEntry },
  })
  .patch('/memories/:memoryId', ({ params, body }) => Chronicle.updateMemory(params.memoryId, body), {
    detail: {
      'summary': 'Update a Chronicle memory',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'memories', 'update'] },
    },
    params: t.Object({ memoryId: t.String({ minLength: 1 }) }),
    body: ChronicleModel.memoryUpdateBody,
    response: { 200: ChronicleModel.memoryEntry },
  })
  .delete('/memories/:memoryId', ({ params }) => Chronicle.deleteMemory(params.memoryId), {
    detail: {
      'summary': 'Delete a Chronicle memory',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'memories', 'delete'] },
    },
    params: t.Object({ memoryId: t.String({ minLength: 1 }) }),
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
  .post('/privacy/redact', ({ body }) => Chronicle.redactPrivacyText(body), {
    detail: {
      'summary': 'Preview Chronicle privacy text redaction',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'privacy', 'redact'] },
    },
    body: ChronicleModel.privacyRedactBody,
    response: { 200: ChronicleModel.privacyRedactResponse },
  })
  .post('/privacy/export', ({ body }) => Chronicle.exportPrivacyRedacted(body), {
    detail: {
      'summary': 'Export Chronicle data with privacy redaction',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'privacy', 'export'] },
    },
    body: ChronicleModel.privacyExportBody,
    response: { 200: ChronicleModel.privacyExportResponse },
  })
  .post('/privacy/snapshots/:snapshotId/frame-mask', ({ params, body }) => Chronicle.getPrivacyMaskedFrameImageBySnapshot(params.snapshotId, body), {
    detail: {
      summary: 'Render a Chronicle snapshot frame with privacy blur masks',
      tags: ['chronicle'],
    },
    params: t.Object({ snapshotId: t.String({ minLength: 1 }) }),
    body: ChronicleModel.privacyFrameMaskBody,
  })
  .get('/privacy/breadcrumbs', ({ query }) => Chronicle.listPrivacyBreadcrumbs(query.limit), {
    detail: {
      'summary': 'List Chronicle privacy breadcrumbs',
      'tags': ['chronicle'],
      'x-cradle-cli': { command: ['chronicle', 'privacy', 'breadcrumbs'] },
    },
    query: t.Object({ limit: t.Optional(t.Number({ default: 50 })) }),
    response: { 200: t.Array(ChronicleModel.privacyBreadcrumb) },
  })
  .post('/embeddings', ({ body }) => Chronicle.embedTexts(body), {
    detail: { summary: 'Generate Chronicle local ONNX text embeddings', tags: ['chronicle'] },
    body: ChronicleModel.embeddingRequestBody,
    response: { 200: ChronicleModel.embeddingResponse },
  })
}

export const chronicle = createChronicleModule()
