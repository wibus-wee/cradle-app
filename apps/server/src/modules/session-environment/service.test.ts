import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { messages, sessions, sessionTextMarkers } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import * as SessionEnvironment from './service'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir: string

function seedSessionMessage(): void {
  const now = Math.floor(Date.now() / 1000)
  db().insert(sessions).values({
    id: 'session-1',
    title: 'Session 1',
    createdAt: now,
    updatedAt: now,
  }).run()
  db().insert(messages).values({
    id: 'message-1',
    sessionId: 'session-1',
    role: 'user',
    status: 'complete',
    content: '  exact rendered text  ',
    messageJson: JSON.stringify({ id: 'message-1', role: 'user', parts: [] }),
    createdAt: now,
    updatedAt: now,
  }).run()
}

describe('session environment markers', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-session-environment-'))
    process.env.CRADLE_DATA_DIR = dataDir
    seedSessionMessage()
  })

  afterEach(() => {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
  })

  it('preserves exact selected text and replaces overlapping ranges', () => {
    SessionEnvironment.addMarker('session-1', {
      messageId: 'message-1',
      startOffset: 0,
      endOffset: 8,
      selectedText: '  exact ',
      style: 'highlight',
      color: 'yellow',
    })

    const replacement = SessionEnvironment.addMarker('session-1', {
      messageId: 'message-1',
      startOffset: 2,
      endOffset: 21,
      selectedText: 'exact rendered text',
      style: 'underline',
      color: 'blue',
    })

    expect(replacement.selectedText).toBe('exact rendered text')
    expect(db().select().from(sessionTextMarkers).where(eq(sessionTextMarkers.sessionId, 'session-1')).all()).toEqual([
      expect.objectContaining({ id: replacement.id, startOffset: 2, endOffset: 21 }),
    ])
  })

  it('rejects empty and inverted ranges', () => {
    expect(() => SessionEnvironment.addMarker('session-1', {
      messageId: 'message-1',
      startOffset: 4,
      endOffset: 4,
      selectedText: 'text',
      style: 'highlight',
      color: 'yellow',
    })).toThrow(expect.objectContaining({ code: 'invalid_session_environment_input', status: 400 }))

    expect(() => SessionEnvironment.addMarker('session-1', {
      messageId: 'message-1',
      startOffset: 0,
      endOffset: 1,
      selectedText: '   ',
      style: 'highlight',
      color: 'yellow',
    })).toThrow(expect.objectContaining({ code: 'invalid_session_environment_input', status: 400 }))
  })
})
