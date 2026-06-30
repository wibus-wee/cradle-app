import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  chronicleAccessibilitySnapshots,
  chronicleActivitySegments,
  chronicleAudioSegments,
  chronicleAudioTranscripts,
  chronicleEvents,
  chronicleMemories,
  chronicleMessages,
  chronicleMessageSources,
  chronicleSnapshots,
  workspaces,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('chronicle privacy capability', () => {
  it('redacts PII in previews and exports while writing privacy breadcrumbs', async () => {
    const dataDir = makeTempDir('cradle-privacy-data-')
    const workspaceRoot = makeTempDir('cradle-privacy-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const workspaceId = randomUUID()
      const now = Math.floor(Date.now() / 1000)

      db().insert(workspaces).values({
        id: workspaceId,
        name: 'Privacy Workspace',
        path: workspaceRoot,
      }).run()
      db().insert(chronicleMemories).values({
        id: 'privacy-memory',
        sourceId: 'privacy-memory-source',
        contentHash: 'privacy-memory-hash',
        workspaceId,
        type: '10min',
        source: 'imported',
        content: 'Email ada@example.com with token sk-privacy123456 and SSN 123-45-6789.',
        createdAt: now,
        updatedAt: now,
      }).run()
      db().insert(chronicleMessageSources).values({
        id: 'privacy-message-source',
        platform: 'slack',
        label: 'Privacy Slack',
        workspaceId,
        channelIdsJson: JSON.stringify(['C123']),
        configJson: JSON.stringify({ realtimeMode: 'polling', signingSecretRef: null, socketAppTokenRef: null }),
      }).run()
      db().insert(chronicleMessages).values({
        id: 'privacy-message',
        sourceId: 'privacy-message-source',
        workspaceId,
        platform: 'slack',
        externalMessageId: 'privacy-message-external',
        channelId: 'C123',
        channelName: 'privacy',
        userName: 'Ada',
        text: 'Call +1 415-555-1212 and use card 4111 1111 1111 1111.',
        messageTs: '1779303000.000100',
        messageAt: now + 1,
        dedupHash: 'privacy-message-hash',
      }).run()
      db().insert(chronicleAudioTranscripts).values({
        id: 'privacy-transcript',
        sourceId: 'privacy-transcript-source',
        workspaceId,
        title: 'Privacy call',
        source: 'imported',
        status: 'imported',
        startedAt: now + 2,
      }).run()
      db().insert(chronicleAudioSegments).values({
        id: 'privacy-transcript-segment',
        transcriptId: 'privacy-transcript',
        segmentIndex: 0,
        startMs: 0,
        text: 'The server address is 192.168.1.100.',
      }).run()
      db().insert(chronicleSnapshots).values({
        id: 'privacy-snapshot',
        sourceId: 'privacy-snapshot-source',
        workspaceId,
        capturedAt: now + 3,
        displayId: 1,
        segmentDir: 'privacy',
        framePath: 'privacy/frame.png',
        ocrText: 'Visible email root@example.com.',
      }).run()

      const redactRes = await app.handle(new Request('http://localhost/chronicle/privacy/redact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Send to root@example.com and sk-preview123456.' }),
      }))
      expect(redactRes.status).toBe(200)
      const redact = await redactRes.json()
      expect(redact.redactedText).toContain('[EMAIL]')
      expect(redact.redactedText).toContain('[API_KEY]')
      expect(redact.redactedText).not.toContain('root@example.com')
      expect(redact.redactedText).not.toContain('sk-preview123456')
      expect(redact.entities).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'email' }),
        expect.objectContaining({ type: 'api_key' }),
      ]))

      const exportRes = await app.handle(new Request('http://localhost/chronicle/privacy/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, outputFormat: 'markdown', limit: 20 }),
      }))
      expect(exportRes.status).toBe(200)
      const exported = await exportRes.json()
      expect(exported.entityCount).toBeGreaterThanOrEqual(6)
      expect(exported.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'memory', id: 'privacy-memory', redactedEntityCount: expect.any(Number) }),
        expect.objectContaining({ type: 'message', id: 'privacy-message', redactedEntityCount: expect.any(Number) }),
        expect.objectContaining({ type: 'audio-transcript', id: 'privacy-transcript', redactedEntityCount: expect.any(Number) }),
        expect.objectContaining({ type: 'snapshot', id: 'privacy-snapshot', redactedEntityCount: expect.any(Number) }),
      ]))
      expect(exported.content).not.toContain('ada@example.com')
      expect(exported.content).not.toContain('sk-privacy123456')
      expect(exported.content).not.toContain('123-45-6789')
      expect(exported.content).not.toContain('415-555-1212')
      expect(exported.content).not.toContain('4111 1111 1111 1111')
      expect(exported.content).not.toContain('192.168.1.100')
      expect(exported.content).not.toContain('root@example.com')
      expect(exported.content).toContain('[EMAIL]')
      expect(exported.content).toContain('[API_KEY]')
      expect(exported.content).toContain('[SSN]')
      expect(exported.content).toContain('[PHONE_NUMBER]')
      expect(exported.content).toContain('[CREDIT_CARD]')
      expect(exported.content).toContain('[IP_ADDRESS]')

      const breadcrumbsRes = await app.handle(new Request('http://localhost/chronicle/privacy/breadcrumbs?limit=20'))
      expect(breadcrumbsRes.status).toBe(200)
      const breadcrumbs = await breadcrumbsRes.json()
      expect(breadcrumbs).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'text-redaction' }),
        expect.objectContaining({ kind: 'redacted-export' }),
      ]))

      const eventRows = db().select().from(chronicleEvents).where(eq(chronicleEvents.type, 'activity')).all()
      expect(eventRows.some(row => row.attrsJson.includes('chronicle-privacy'))).toBe(true)
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) { delete process.env.CRADLE_DATA_DIR }
      else { process.env.CRADLE_DATA_DIR = previousDataDir }
    }
  })

  it('renders full-frame and region screenshot blur masks while preserving original artifacts', async () => {
    const dataDir = makeTempDir('cradle-privacy-data-')
    const storageRoot = makeTempDir('cradle-privacy-storage-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const now = Math.floor(Date.now() / 1000)
      const frameDir = join(storageRoot, 'privacy-mask')
      const framePath = join(frameDir, 'frame.png')
      mkdirSync(frameDir, { recursive: true })
      await sharp({
        create: {
          width: 12,
          height: 8,
          channels: 3,
          background: { r: 255, g: 0, b: 0 },
        },
      })
        .composite([{
          input: {
            create: {
              width: 6,
              height: 8,
              channels: 3,
              background: { r: 0, g: 0, b: 255 },
            },
          },
          left: 6,
          top: 0,
        }])
        .png()
        .toFile(framePath)
      const originalBytes = readFileSync(framePath)

      const configResponse = await app.handle(new Request('http://localhost/chronicle/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: '',
          modelId: '',
          workspaceId: '',
          enabled: false,
          activityPipelineEnabled: true,
          activityPipelineIntervalMs: 120_000,
          activityPipelineBatchSize: 3,
          dreamSchedulerEnabled: true,
          dreamSchedulerIntervalMs: 86_400_000,
          dreamSchedulerApplyMerge: false,
          audioCaptureEnabled: false,
          audioSource: 'microphone',
          audioSegmentMs: 5_000,
          audioSegmentIntervalMs: 60_000,
          audioRmsThreshold: 0.02,
          storageRoot,
        }),
      }))
      expect(configResponse.status).toBe(200)

      db().insert(chronicleSnapshots).values({
        id: 'privacy-mask-snapshot',
        sourceId: 'privacy-mask-source',
        capturedAt: now,
        displayId: 1,
        segmentDir: 'privacy-mask',
        framePath: 'privacy-mask/frame.png',
        ocrText: 'Sensitive screenshot',
      }).run()

      const fullFrameResponse = await app.handle(new Request('http://localhost/chronicle/privacy/snapshots/privacy-mask-snapshot/frame-mask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullFrame: true, blurSigma: 8 }),
      }))
      expect(fullFrameResponse.status).toBe(200)
      expect(fullFrameResponse.headers.get('content-type')).toBe('image/png')
      expect(fullFrameResponse.headers.get('cache-control')).toBe('no-store')
      const fullFrameBytes = Buffer.from(await fullFrameResponse.arrayBuffer())
      expect(fullFrameBytes.equals(originalBytes)).toBe(false)

      const regionResponse = await app.handle(new Request('http://localhost/chronicle/privacy/snapshots/privacy-mask-snapshot/frame-mask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          blurSigma: 8,
          regions: [{ x: 4, y: 0, width: 6, height: 8 }],
        }),
      }))
      expect(regionResponse.status).toBe(200)
      const regionBytes = Buffer.from(await regionResponse.arrayBuffer())
      expect(regionBytes.equals(originalBytes)).toBe(false)
      expect(readFileSync(framePath).equals(originalBytes)).toBe(true)

      const breadcrumbsRes = await app.handle(new Request('http://localhost/chronicle/privacy/breadcrumbs?limit=20'))
      expect(breadcrumbsRes.status).toBe(200)
      const breadcrumbs = await breadcrumbsRes.json()
      expect(breadcrumbs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'screenshot-mask',
          snapshotId: 'privacy-mask-snapshot',
          attrs: expect.objectContaining({ fullFrame: true, regionCount: 1 }),
        }),
        expect.objectContaining({
          kind: 'screenshot-mask',
          snapshotId: 'privacy-mask-snapshot',
          attrs: expect.objectContaining({ fullFrame: false, regionCount: 1 }),
        }),
      ]))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(storageRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) { delete process.env.CRADLE_DATA_DIR }
      else { process.env.CRADLE_DATA_DIR = previousDataDir }
    }
  })

  it('keeps closed-eyes snapshot reports while the runtime discard gate is disabled', async () => {
    const dataDir = makeTempDir('cradle-privacy-data-')
    const storageRoot = makeTempDir('cradle-privacy-storage-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = await createServerApp({ startBackgroundTasks: false })

      const configResponse = await app.handle(new Request('http://localhost/chronicle/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profileId: '',
          modelId: '',
          workspaceId: '',
          enabled: false,
          activityPipelineEnabled: true,
          activityPipelineIntervalMs: 120_000,
          activityPipelineBatchSize: 3,
          dreamSchedulerEnabled: true,
          dreamSchedulerIntervalMs: 86_400_000,
          dreamSchedulerApplyMerge: false,
          audioCaptureEnabled: false,
          audioSource: 'microphone',
          audioSegmentMs: 5_000,
          audioSegmentIntervalMs: 60_000,
          audioRmsThreshold: 0.02,
          storageRoot,
          closedEyesDiscardEnabled: true,
          closedEyesMode: 'auto',
        }),
      }))
      expect(configResponse.status).toBe(200)

      const snapshotResponse = await app.handle(new Request('http://localhost/chronicle/snapshots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceId: 'closed-eyes-snapshot-source',
          displayId: 1,
          frameIndex: 8,
          capturedAt: '2026-05-21T10-01-00Z',
          segmentDir: 'closed-eyes',
          framePath: 'closed-eyes/frame-00008.jpg',
          ocrText: 'This text should become durable evidence',
          appBundleId: 'app.cradle.desktop',
          windowTitle: 'Cradle Chronicle',
          closedEyes: {
            status: 'absent',
            confidence: 0.91,
            detector: 'test-presence-detector',
            reason: 'user is absent from camera frame',
          },
          accessibility: {
            sourceId: 'accessibility:closed-eyes-snapshot-source',
            status: 'ready',
            provider: 'macos-accessibility-window-inventory',
            text: 'This accessibility text should persist',
            elementCount: 1,
            tree: [{ role: 'AXWindow', label: 'Cradle Chronicle' }],
          },
          metadata: { source: 'closed-eyes-test' },
        }),
      }))
      expect(snapshotResponse.status).toBe(200)
      const snapshot = await snapshotResponse.json() as {
        id: string
        sourceId: string
        ocrText: string
      }
      expect(snapshot).toEqual(expect.objectContaining({
        sourceId: 'closed-eyes-snapshot-source',
        ocrText: 'This text should become durable evidence',
      }))

      expect(db().select().from(chronicleSnapshots).where(eq(chronicleSnapshots.sourceId, 'closed-eyes-snapshot-source')).all()).toHaveLength(1)
      expect(db().select().from(chronicleAccessibilitySnapshots).where(eq(chronicleAccessibilitySnapshots.sourceId, 'accessibility:closed-eyes-snapshot-source')).all()).toHaveLength(1)
      expect(db().select().from(chronicleActivitySegments).all()).toHaveLength(1)

      const breadcrumbsRes = await app.handle(new Request('http://localhost/chronicle/privacy/breadcrumbs?limit=20'))
      expect(breadcrumbsRes.status).toBe(200)
      const breadcrumbs = await breadcrumbsRes.json()
      expect(breadcrumbs).not.toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'closed-eyes-discard',
        }),
      ]))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(storageRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) { delete process.env.CRADLE_DATA_DIR }
      else { process.env.CRADLE_DATA_DIR = previousDataDir }
    }
  })
})
