import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendRuns, chatMessagePayloads, messages, sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import {
  appendSessionObservationMessage,
  JARVIS_AMBIENT_SESSION_ORIGIN,
} from './observation-message'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-observation-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH

  try {
    return await callback()
  }
  finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_DB_PATH', previousDbPath)
  }
}

function seedSession(input: {
  sessionId: string
  origin?: string
  archivedAt?: number | null
}): void {
  db()
    .insert(sessions)
    .values({
      id: input.sessionId,
      title: 'Observation Test',
      titleSource: 'initial',
      runtimeKind: 'jar-core',
      origin: input.origin ?? JARVIS_AMBIENT_SESSION_ORIGIN,
      archivedAt: input.archivedAt ?? null,
      createdAt: 100,
      updatedAt: 100,
    })
    .run()
}

describe('appendSessionObservationMessage', () => {
  it('appends a user observation without creating a backend run', async () => {
    await withTempDataDir(async () => {
      seedSession({ sessionId: 'ambient-1' })
      const text = '[activity] segment ended: entity=chat:s1 type=chat durationMs=45000 endReason=idle'
      const result = await appendSessionObservationMessage({
        sessionId: 'ambient-1',
        text,
        entity: 'chat:s1',
        entityType: 'chat',
        durationMs: 45_000,
        endReason: 'idle',
      })

      expect(result.messageId).toBeTruthy()
      const rows = db().select().from(messages).where(eq(messages.sessionId, 'ambient-1')).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.role).toBe('user')

      const payload = db()
        .select()
        .from(chatMessagePayloads)
        .where(eq(chatMessagePayloads.id, rows[0]!.payloadId))
        .get()
      expect(payload?.content).toContain('segment ended')
      expect(payload?.messageJson).toContain(text)
      expect(payload?.messageJson).not.toContain('<cradle_context>')
      expect(payload?.messageJson).toContain('"kind":"ui-activity"')

      const runs = db().select().from(backendRuns).where(eq(backendRuns.chatSessionId, 'ambient-1')).all()
      expect(runs).toHaveLength(0)
    })
  })

  it('rejects non-ambient sessions', async () => {
    await withTempDataDir(async () => {
      seedSession({ sessionId: 'manual-1', origin: 'manual' })
      await expect(appendSessionObservationMessage({
        sessionId: 'manual-1',
        text: '[activity] segment ended: entity=app:home type=app durationMs=30000 endReason=hidden',
      })).rejects.toMatchObject({ code: 'observation_session_not_eligible' })
    })
  })

  it('rejects cradle context blocks in observation text', async () => {
    await withTempDataDir(async () => {
      seedSession({ sessionId: 'ambient-2' })
      await expect(appendSessionObservationMessage({
        sessionId: 'ambient-2',
        text: '<cradle_context>secret</cradle_context>',
      })).rejects.toMatchObject({ code: 'observation_text_invalid' })
    })
  })
})
