import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { shutdownInfra } from '../../infra'
import {
  getArtifact,
  listArtifacts,
  upsertArtifact,
} from './service'

const sessionMock = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../session/service', () => sessionMock)

const SESSION_ID = 'session-artifacts-1'
const VALID_SOURCE = `
import { Artifact, Header } from 'cradle/artifact'

export default function Demo() {
  return (
    <Artifact>
      <Header title="Hello" />
    </Artifact>
  )
}
`

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousDbPath = process.env.CRADLE_DB_PATH
let dataDir: string

describe('chat-artifacts service', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-artifacts-'))
    process.env.CRADLE_DATA_DIR = dataDir
    delete process.env.CRADLE_DB_PATH
    shutdownInfra()
    sessionMock.get.mockReset()
    sessionMock.get.mockReturnValue({
      id: SESSION_ID,
      title: 'Artifacts session',
    })
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
    if (previousDbPath === undefined) {
      delete process.env.CRADLE_DB_PATH
    }
    else {
      process.env.CRADLE_DB_PATH = previousDbPath
    }
    vi.useRealTimers()
  })

  it('creates an artifact at revision 1', () => {
    const record = upsertArtifact({
      sessionId: SESSION_ID,
      artifactId: 'welcome-card',
      title: 'Welcome',
      source: VALID_SOURCE,
    })

    expect(record).toMatchObject({
      id: 'welcome-card',
      sessionId: SESSION_ID,
      title: 'Welcome',
      source: VALID_SOURCE,
      revision: 1,
    })
    expect(record.createdAt).toBe(record.updatedAt)
  })

  it('updates the same id and increments revision', () => {
    const created = upsertArtifact({
      sessionId: SESSION_ID,
      artifactId: 'welcome-card',
      title: 'Welcome',
      source: VALID_SOURCE,
    })

    const updatedSource = `
import { Artifact, Header } from 'cradle/artifact'

export default function Demo() {
  return (
    <Artifact>
      <Header title="Updated" />
    </Artifact>
  )
}
`
    const updated = upsertArtifact({
      sessionId: SESSION_ID,
      artifactId: 'welcome-card',
      title: 'Welcome Updated',
      source: updatedSource,
    })

    expect(updated.id).toBe(created.id)
    expect(updated.revision).toBe(2)
    expect(updated.title).toBe('Welcome Updated')
    expect(updated.source).toBe(updatedSource)
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
  })

  it('getArtifact returns the stored record', () => {
    const created = upsertArtifact({
      sessionId: SESSION_ID,
      artifactId: 'welcome-card',
      title: 'Welcome',
      source: VALID_SOURCE,
    })

    expect(getArtifact(SESSION_ID, 'welcome-card')).toEqual(created)
  })

  it('listArtifacts returns records sorted by updatedAt descending', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    upsertArtifact({
      sessionId: SESSION_ID,
      artifactId: 'older',
      title: 'Older',
      source: VALID_SOURCE,
    })

    vi.setSystemTime(new Date('2026-01-01T00:00:10Z'))
    upsertArtifact({
      sessionId: SESSION_ID,
      artifactId: 'newer',
      title: 'Newer',
      source: VALID_SOURCE,
    })

    expect(listArtifacts(SESSION_ID).map(record => record.id)).toEqual(['newer', 'older'])
  })

  it('throws for an invalid artifact id', () => {
    expect(() => upsertArtifact({
      sessionId: SESSION_ID,
      artifactId: '../escape',
      title: 'Bad Id',
      source: VALID_SOURCE,
    })).toThrowError(expect.objectContaining({
      code: 'chat_artifact_id_invalid',
      status: 400,
    }))
  })

  it('throws for empty title or source', () => {
    expect(() => upsertArtifact({
      sessionId: SESSION_ID,
      artifactId: 'welcome-card',
      title: '   ',
      source: VALID_SOURCE,
    })).toThrowError(expect.objectContaining({
      code: 'chat_artifact_title_invalid',
      status: 400,
    }))

    expect(() => upsertArtifact({
      sessionId: SESSION_ID,
      artifactId: 'welcome-card',
      title: 'Welcome',
      source: '   ',
    })).toThrowError(expect.objectContaining({
      code: 'chat_artifact_source_empty',
      status: 400,
    }))
  })

  it('throws for invalid source with a disallowed import', () => {
    expect(() => upsertArtifact({
      sessionId: SESSION_ID,
      artifactId: 'welcome-card',
      title: 'Welcome',
      source: `
import { Artifact } from 'cradle/artifact'
import { Button } from '~/components/ui/button'

export default function Demo() {
  return <Artifact title="x" />
}
`,
    })).toThrowError(expect.objectContaining({
      code: 'chat_artifact_source_invalid',
      status: 400,
    }))
  })

  it('throws when the session is missing', () => {
    sessionMock.get.mockReturnValue(null)

    expect(() => upsertArtifact({
      sessionId: 'missing-session',
      artifactId: 'welcome-card',
      title: 'Welcome',
      source: VALID_SOURCE,
    })).toThrowError(expect.objectContaining({
      code: 'chat_artifact_session_not_found',
      status: 404,
    }))

    expect(() => getArtifact('missing-session', 'welcome-card')).toThrowError(
      expect.objectContaining({
        code: 'chat_artifact_session_not_found',
        status: 404,
      }),
    )

    expect(() => listArtifacts('missing-session')).toThrowError(
      expect.objectContaining({
        code: 'chat_artifact_session_not_found',
        status: 404,
      }),
    )
  })
})
