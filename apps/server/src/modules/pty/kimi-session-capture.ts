import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'

import { z } from 'zod'

const CAPTURE_LOOKBACK_MS = 5_000
const CAPTURE_LOOKAHEAD_MS = 120_000
const SESSION_ID_RE = /^session_\w(?:\w|-){0,255}$/

const SessionIndexEntrySchema = z.object({
  sessionId: z.string().regex(SESSION_ID_RE),
  sessionDir: z.string().min(1),
  workDir: z.string().min(1),
})

const SessionStateSchema = z.object({
  workDir: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  title: z.string().optional(),
  lastPrompt: z.string().optional(),
})

export interface CaptureKimiCliSessionInput {
  workspacePath: string
  startedAt: number
  kimiCodeHome?: string
  env?: Record<string, string>
  now?: () => number
}

interface SessionIndexEntry {
  sessionId: string
  sessionDir: string
  workDir: string
}

interface Candidate {
  sessionId: string
  statePath: string
  timestampMs: number
  title: string | undefined
}

export interface KimiCliSessionBinding {
  sessionId: string
  capturedAt: number
  startedAt: number
  workspacePath: string
  sourcePath: string
  title?: string
}

export async function captureKimiCliSession(rawInput: CaptureKimiCliSessionInput): Promise<KimiCliSessionBinding | null> {
  const input = {
    ...rawInput,
    now: rawInput.now ?? (() => Date.now()),
  }
  const home = resolve(input.kimiCodeHome ?? input.env?.KIMI_CODE_HOME ?? process.env.KIMI_CODE_HOME ?? join(homedir(), '.kimi-code'))
  const sessionsRoot = resolve(join(home, 'sessions'))
  const index = await readSessionIndex(join(home, 'session_index.jsonl'))
  const workspacePath = normalize(resolve(input.workspacePath))
  const lowerBound = input.startedAt - CAPTURE_LOOKBACK_MS
  const upperBound = input.startedAt + CAPTURE_LOOKAHEAD_MS
  const matches: Candidate[] = []

  for (const entry of index.values()) {
    const sessionDir = resolve(entry.sessionDir)
    if (!isInside(sessionsRoot, sessionDir)) {
      continue
    }

    const statePath = join(sessionDir, 'state.json')
    const state = await readSessionState(statePath)
    const workDir = state?.workDir ?? state?.cwd ?? entry.workDir
    if (normalize(resolve(workDir)) !== workspacePath) {
      continue
    }

    const timestampMs = sessionTimestampMs(state)
    if (timestampMs === null || timestampMs < lowerBound || timestampMs > upperBound) {
      continue
    }
    matches.push({ sessionId: entry.sessionId, statePath, timestampMs, title: sessionTitle(state) })
  }

  if (matches.length !== 1) {
    return null
  }

  const match = matches[0]!
  return {
    sessionId: match.sessionId,
    capturedAt: Math.floor(input.now() / 1000),
    startedAt: Math.floor(input.startedAt / 1000),
    workspacePath,
    sourcePath: match.statePath,
    ...(match.title ? { title: match.title } : {}),
  }
}

async function readSessionIndex(path: string): Promise<Map<string, SessionIndexEntry>> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  }
  catch {
    return new Map()
  }

  const entries = new Map<string, SessionIndexEntry>()
  for (const line of raw.split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line) as unknown
      if (isDeletion(parsed)) {
        entries.delete(parsed.sessionId)
        continue
      }
      const entry = SessionIndexEntrySchema.parse(parsed)
      entries.set(entry.sessionId, entry)
    }
    catch {
      // Ignore incomplete or malformed append-only index lines.
    }
  }
  return entries
}

async function readSessionState(path: string): Promise<z.infer<typeof SessionStateSchema> | null> {
  try {
    return SessionStateSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  }
  catch {
    return null
  }
}

function sessionTimestampMs(state: z.infer<typeof SessionStateSchema> | null): number | null {
  if (!state) {
    return null
  }
  const timestamps = [state.createdAt, state.updatedAt]
    .filter((value): value is string => Boolean(value))
    .map(value => Date.parse(value))
    .filter(value => Number.isFinite(value))
  return timestamps.length > 0 ? Math.max(...timestamps) : null
}

function sessionTitle(state: z.infer<typeof SessionStateSchema> | null): string | undefined {
  if (!state) {
    return undefined
  }
  const title = state.title?.trim()
  if (title && title !== 'New Session') {
    return title.slice(0, 200)
  }
  const lastPrompt = state.lastPrompt?.trim()
  return lastPrompt ? lastPrompt.slice(0, 200) : undefined
}

function isDeletion(value: unknown): value is { sessionId: string, deleted: true } {
  return typeof value === 'object'
    && value !== null
    && (value as { deleted?: unknown }).deleted === true
    && typeof (value as { sessionId?: unknown }).sessionId === 'string'
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path !== '' && !path.startsWith('..') && !isAbsolute(path)
}

export const __kimiSessionCaptureTestUtils = {
  readSessionIndex,
  readSessionState,
  sessionTimestampMs,
  sessionTitle,
}
