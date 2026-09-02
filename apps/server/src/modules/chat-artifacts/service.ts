import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { getServerConfig } from '../../infra'
import * as Session from '../session/service'
import { assertValidArtifactSource } from './validate-source'

export interface ChatArtifactRecord {
  id: string
  sessionId: string
  title: string
  source: string
  revision: number
  createdAt: number
  updatedAt: number
}

const ARTIFACT_ID_PATTERN = /^[a-z0-9][\w.-]{0,127}$/i
const MAX_TITLE_LENGTH = 200
const MAX_SOURCE_BYTES = 512 * 1024

function artifactsRoot(): string {
  const config = getServerConfig()
  const dataRoot = resolve(config.dataDir ?? dirname(config.dbPath))
  return join(dataRoot, 'chat-artifacts')
}

function sessionDir(sessionId: string): string {
  return join(artifactsRoot(), sessionId)
}

function artifactPath(sessionId: string, artifactId: string): string {
  return join(sessionDir(sessionId), `${artifactId}.json`)
}

function assertSession(sessionId: string) {
  const session = Session.get(sessionId)
  if (!session) {
    throw new AppError({
      code: 'chat_artifact_session_not_found',
      status: 404,
      message: 'Chat session not found for artifact.',
      details: { sessionId },
    })
  }
  return session
}

function assertArtifactId(artifactId: string) {
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    throw new AppError({
      code: 'chat_artifact_id_invalid',
      status: 400,
      message: 'Artifact id must be 1–128 chars of letters, numbers, dot, underscore, or hyphen.',
      details: { artifactId },
    })
  }
}

function readRecord(sessionId: string, artifactId: string): ChatArtifactRecord | null {
  try {
    const raw = readFileSync(artifactPath(sessionId, artifactId), 'utf8')
    const parsed = JSON.parse(raw) as ChatArtifactRecord
    if (
      typeof parsed.id !== 'string'
      || typeof parsed.sessionId !== 'string'
      || typeof parsed.title !== 'string'
      || typeof parsed.source !== 'string'
      || typeof parsed.revision !== 'number'
    ) {
      return null
    }
    return parsed
  }
  catch {
    return null
  }
}

function writeRecord(record: ChatArtifactRecord): void {
  const dir = sessionDir(record.sessionId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(artifactPath(record.sessionId, record.id), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

export function upsertArtifact(input: {
  sessionId: string
  artifactId?: string | null
  title: string
  source: string
}): ChatArtifactRecord {
  assertSession(input.sessionId)

  const title = input.title.trim()
  if (!title || title.length > MAX_TITLE_LENGTH) {
    throw new AppError({
      code: 'chat_artifact_title_invalid',
      status: 400,
      message: `Artifact title must be 1–${MAX_TITLE_LENGTH} characters.`,
    })
  }

  const source = input.source
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new AppError({
      code: 'chat_artifact_source_empty',
      status: 400,
      message: 'Artifact source must be non-empty JSX.',
    })
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new AppError({
      code: 'chat_artifact_source_too_large',
      status: 400,
      message: `Artifact source exceeds ${MAX_SOURCE_BYTES} bytes.`,
    })
  }

  assertValidArtifactSource(source)

  const artifactId = (input.artifactId?.trim() || createArtifactId(title))
  assertArtifactId(artifactId)

  const existing = readRecord(input.sessionId, artifactId)
  const now = currentUnixSeconds()
  const record: ChatArtifactRecord = existing
    ? {
        ...existing,
        title,
        source,
        revision: existing.revision + 1,
        updatedAt: now,
      }
    : {
        id: artifactId,
        sessionId: input.sessionId,
        title,
        source,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }

  writeRecord(record)
  return record
}

export function getArtifact(sessionId: string, artifactId: string): ChatArtifactRecord {
  assertSession(sessionId)
  assertArtifactId(artifactId)
  const record = readRecord(sessionId, artifactId)
  if (!record) {
    throw new AppError({
      code: 'chat_artifact_not_found',
      status: 404,
      message: 'Artifact not found.',
      details: { sessionId, artifactId },
    })
  }
  return record
}

export function listArtifacts(sessionId: string): ChatArtifactRecord[] {
  assertSession(sessionId)
  const dir = sessionDir(sessionId)
  let names: string[] = []
  try {
    names = readdirSync(dir).filter(name => name.endsWith('.json'))
  }
  catch {
    return []
  }

  const records: ChatArtifactRecord[] = []
  for (const name of names) {
    const id = name.slice(0, -'.json'.length)
    const record = readRecord(sessionId, id)
    if (record) {
      records.push(record)
    }
  }
  return records.sort((left, right) => right.updatedAt - left.updatedAt)
}

function createArtifactId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'artifact'
  const suffix = createHash('sha256').update(`${title}:${randomUUID()}`).digest('hex').slice(0, 8)
  return `${slug}-${suffix}`
}

export function removeSessionArtifacts(sessionId: string): void {
  rmSync(sessionDir(sessionId), { recursive: true, force: true })
}

Session.onSessionCleanup(removeSessionArtifacts)
Session.onSessionTranscriptCleanup(removeSessionArtifacts)
