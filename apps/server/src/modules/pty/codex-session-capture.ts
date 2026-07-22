import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'
import { createInterface } from 'node:readline'

import { z } from 'zod'

import type { CodexCliSessionBinding } from '../../helpers/agent-runtime-config'

const MAX_FILES_PER_DIRECTORY = 80
const MAX_CANDIDATE_FILES = 120
const CAPTURE_LOOKBACK_MS = 5_000
const CAPTURE_LOOKAHEAD_MS = 120_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROLLOUT_FILENAME_RE = /^rollout-.+\.jsonl$/
const TimestampMsTextSchema = z.string()
  .transform(value => Date.parse(value))
  .pipe(z.number().finite())

export interface CaptureCodexCliSessionInput {
  workspacePath: string
  startedAt: number
  codexSessionsRoot?: string
  env?: Record<string, string>
  now?: () => number
}

interface CandidateFile {
  path: string
  mtimeMs: number
}

interface CodexSessionMeta {
  id: string
  timestampMs: number
  cwd: string
  originator: string
}

const CodexSessionMetaLineSchema = z.object({
  type: z.literal('session_meta'),
  payload: z.object({
    id: z.string().regex(UUID_RE),
    timestamp: z.string(),
    cwd: z.string().min(1),
    originator: z.string(),
  }),
}).transform(({ payload }) => ({
  id: payload.id,
  timestampMs: TimestampMsTextSchema.parse(payload.timestamp),
  cwd: payload.cwd,
  originator: payload.originator,
}))
const CodexSessionMetaLineJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(CodexSessionMetaLineSchema)

const CaptureCodexCliSessionInputSchema = z.object({
  workspacePath: z.string(),
  startedAt: z.number().finite(),
  codexSessionsRoot: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  now: z.custom<() => number>().default(() => Date.now),
})

export async function captureCodexCliSession(rawInput: CaptureCodexCliSessionInput): Promise<CodexCliSessionBinding | null> {
  const input = CaptureCodexCliSessionInputSchema.parse(rawInput)
  const files = await listRecentSessionFiles({
    root: input.codexSessionsRoot ?? defaultCodexSessionsRoot(input.env),
    startedAt: input.startedAt,
  })

  const workspacePath = normalize(input.workspacePath)
  const lowerBound = input.startedAt - CAPTURE_LOOKBACK_MS
  const upperBound = input.startedAt + CAPTURE_LOOKAHEAD_MS
  const matches: Array<CodexSessionMeta & { sourcePath: string }> = []

  for (const file of files) {
    const meta = await readSessionMeta(file.path)
    if (!meta) {
      continue
    }
    if (normalize(meta.cwd) !== workspacePath) {
      continue
    }
    if (meta.originator !== 'codex-tui') {
      continue
    }
    if (meta.timestampMs < lowerBound || meta.timestampMs > upperBound) {
      continue
    }
    matches.push({ ...meta, sourcePath: file.path })
  }

  if (matches.length !== 1) {
    return null
  }

  const match = matches[0]!
  return {
    sessionId: match.id,
    capturedAt: Math.floor(input.now() / 1000),
    startedAt: Math.floor(input.startedAt / 1000),
    workspacePath,
    sourcePath: match.sourcePath,
  }
}

function defaultCodexSessionsRoot(env: Record<string, string> | undefined): string {
  return join(env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
}

async function listRecentSessionFiles(input: {
  root: string
  startedAt: number
}): Promise<CandidateFile[]> {
  const directories = sessionDirectoriesNear(input.root, new Date(input.startedAt))
  const lowerBound = input.startedAt - CAPTURE_LOOKBACK_MS
  const upperBound = input.startedAt + CAPTURE_LOOKAHEAD_MS
  const files: CandidateFile[] = []

  for (const directory of directories) {
    let names: string[]
    try {
      names = await readdir(directory)
    }
    catch {
      continue
    }

    const directoryFiles: CandidateFile[] = []
    for (const name of names) {
      if (!ROLLOUT_FILENAME_RE.test(name)) {
        continue
      }

      const path = join(directory, name)
      try {
        const stats = await stat(path)
        if (!stats.isFile()) {
          continue
        }
        if (stats.mtimeMs < lowerBound || stats.mtimeMs > upperBound) {
          continue
        }
        directoryFiles.push({ path, mtimeMs: stats.mtimeMs })
      }
      catch {
        continue
      }
    }

    directoryFiles.sort((left, right) => right.mtimeMs - left.mtimeMs)
    files.push(...directoryFiles.slice(0, MAX_FILES_PER_DIRECTORY))
  }

  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, MAX_CANDIDATE_FILES)
}

function sessionDirectoriesNear(root: string, date: Date): string[] {
  const days = [
    new Date(date.getTime() - 24 * 60 * 60 * 1000),
    date,
    new Date(date.getTime() + 24 * 60 * 60 * 1000),
  ]

  return Array.from(new Set(days.map(day => join(
    root,
    String(day.getFullYear()),
    padDatePart(day.getMonth() + 1),
    padDatePart(day.getDate()),
  ))))
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

async function readSessionMeta(path: string): Promise<CodexSessionMeta | null> {
  const line = await readFirstLine(path)
  if (!line) {
    return null
  }

  try {
    return CodexSessionMetaLineJsonSchema.parse(line)
  }
  catch {
    return null
  }
}

async function readFirstLine(path: string): Promise<string | null> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const reader = createInterface({ input: stream, crlfDelay: Infinity })

  try {
    for await (const line of reader) {
      return line
    }
    return null
  }
  finally {
    reader.close()
    stream.destroy()
  }
}

export const __codexSessionCaptureTestUtils = {
  readSessionMeta,
  sessionDirectoriesNear,
}
