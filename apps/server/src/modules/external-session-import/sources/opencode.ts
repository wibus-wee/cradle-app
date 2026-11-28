import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip, gzipSync } from 'node:zlib'

import type { UIMessage } from 'ai'
import Database from 'better-sqlite3'
import { z } from 'zod'

import { getServerConfig } from '../../../infra'
import { EXTERNAL_SESSION_IMPORT_PARSER_VERSION, openExternalSessionBundleFile } from '../bundle-store'
import { defaultOpenCodeImportRoots } from '../cradle-runtime-roots'
import {
  compactText,
  createCandidateId,
  createContentHash,
  createImportedMessageId,
  createSourceFilesRevision,
  emptyGitIdentity,
  importedMessage,
  mergeExternalSessionDescriptors,
  safeJsonValue,
  titleFromText,
} from '../source-utils'
import type {
  ExternalSessionBundle,
  ExternalSessionBundleFile,
  ExternalSessionBundleManifest,
  ExternalSessionDescriptor,
  ExternalSessionFidelityReport,
  ExternalSessionImportMessage,
  ExternalSessionReadResult,
  ExternalSessionSourceAdapter,
  ExternalSessionSourceFile,
} from '../types'

// OpenCode keeps a session as rows, not a file of lines: since 1.2 in its
// SQLite database opencode.db (session/message/part tables, each message and
// part a JSON document), before that as JSON files under storage/ —
// session/<project>/<id>.json, message/<session>/<id>.json and
// part/<message>/<id>.json. OpenCode 2 uses session_v2/session_message tables
// in the same database and copies old sessions over on first start, recording
// kv migration.v1-v2 {"phase":"completed"} when done; while migration is
// underway, sessions not yet copied are still read from the v1 tables. Where
// a database exists at all, only it is read — the storage/ files stay behind
// and go stale. This mirrors magpie internal/sessions/opencode.go and
// transcript_opencode.go, the format authority.

const OPENCODE_DB_NAME = 'opencode.db'
const OPENCODE_MIGRATION_KEY = 'migration.v1-v2'
const OPENCODE_PARENT_WALK_LIMIT = 64

const OpenCodeV1SessionSchema = z.object({
  id: z.string().min(1),
  parentID: z.string().nullable().optional(),
  directory: z.string().optional(),
  title: z.string().optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }).optional(),
}).passthrough()

const OpenCodeV1MessageSchema = z.object({
  id: z.string().optional(),
  role: z.string(),
  modelID: z.string().optional(),
  time: z.object({
    created: z.number().optional(),
    completed: z.number().optional(),
  }).optional(),
}).passthrough()

const OpenCodePartSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  text: z.string().optional(),
  name: z.string().optional(),
  tool: z.string().optional(),
  callID: z.string().optional(),
  synthetic: z.boolean().optional(),
  ignored: z.boolean().optional(),
  state: z.object({
    status: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    error: z.unknown().optional(),
    content: z.array(z.object({
      type: z.string().optional(),
      text: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough().optional(),
}).passthrough()

const OpenCodeV2UserDataSchema = z.object({
  text: z.string().optional(),
  files: z.array(z.unknown()).optional(),
}).passthrough()

const OpenCodeV2AssistantDataSchema = z.object({
  model: z.object({
    id: z.string().optional(),
    providerID: z.string().optional(),
    variant: z.string().optional(),
  }).passthrough().optional(),
  content: z.array(z.record(z.string(), z.unknown())).optional(),
  time: z.object({
    created: z.number().optional(),
    completed: z.number().optional(),
  }).passthrough().optional(),
}).passthrough()

// The bundle-store manifest schema pins sourceApp to the originally shipped
// union; OpenCode manifests are identical in every other field.
const OpenCodeBundleManifestSchema = z.object({
  version: z.literal(1),
  parserVersion: z.number().int().positive(),
  sourceHostId: z.string().min(1),
  sourceApp: z.string().min(1),
  externalSessionId: z.string().min(1),
  sourceRevision: z.string().min(1),
  capturedAt: z.number().int().nonnegative(),
  files: z.array(z.object({
    sourcePath: z.string().min(1),
    bundlePath: z.string().min(1),
    kind: z.enum(['main', 'subagent']),
    sourceId: z.string().min(1),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })).min(1),
})

export interface OpenCodeSessionSourceOptions {
  /** OpenCode data directories; defaults to the user data dir resolution. */
  dataDirs?: string[]
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

interface OpenCodeDbSessionRow {
  id: string
  parentId: string
  directory: string
  title: string
  timeCreated: number
  timeUpdated: number
  lastMessageUpdated: number
  store: 'v2' | 'v1'
}

interface OpenCodeLegacySession {
  info: z.infer<typeof OpenCodeV1SessionSchema>
  files: ExternalSessionSourceFile[]
  updatedAtMs: number
}

interface OpenCodeNormalizedMessage {
  id: string
  role: 'user' | 'assistant'
  createdMs: number
  userText: string
  files: unknown[]
  parts: Array<z.infer<typeof OpenCodePartSchema>>
}

export function createOpenCodeSessionSource(
  options: OpenCodeSessionSourceOptions = {},
): ExternalSessionSourceAdapter {
  const dataDirs = options.dataDirs ?? defaultOpenCodeImportRoots({
    env: options.env,
    homeDir: options.homeDir,
  })
  return {
    sourceApp: 'opencode' as ExternalSessionSourceAdapter['sourceApp'],
    async discover(input) {
      const discoveries = await Promise.all(dataDirs.map(dataDir =>
        discoverOpenCodeSessions(dataDir, input)))
      return mergeExternalSessionDescriptors(discoveries.flat())
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
        .slice(0, input.limit ?? 2_000)
    },
    async capture(input) {
      return await captureOpenCodeSession(input.descriptor)
    },
    async read(input) {
      return await readOpenCodeSession(input.descriptor, input.bundle)
    },
  }
}

async function discoverOpenCodeSessions(
  dataDir: string,
  input: { sourceHostId: string },
): Promise<ExternalSessionDescriptor[]> {
  const dbPath = resolveOpenCodeDbPath(dataDir)
  if (await isRegularFile(dbPath)) {
    return await discoverOpenCodeDatabaseSessions(dbPath, input.sourceHostId)
  }
  return await discoverOpenCodeLegacySessions(join(dataDir, 'storage'), input.sourceHostId)
}

/**
 * OpenCode's database: $OPENCODE_DB (a path in the data folder unless
 * absolute), else opencode.db there — mirrors magpie openCodeDB.
 */
function resolveOpenCodeDbPath(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCODE_DB
  if (override && override !== ':memory:') {
    return resolve(override.startsWith(sep) ? override : join(dataDir, override))
  }
  return join(dataDir, OPENCODE_DB_NAME)
}

// ---- database discovery -----------------------------------------------------

async function discoverOpenCodeDatabaseSessions(
  dbPath: string,
  sourceHostId: string,
): Promise<ExternalSessionDescriptor[]> {
  const rows = withOpenCodeDatabase(dbPath, db => readOpenCodeSessionRows(db))
  if (!rows) {
    return []
  }
  const parent = new Map(rows.map(row => [row.id, row.parentId]))
  const roots = new Map(rows.map(row => [row.id, openCodeRootSessionId(row.id, parent)]))
  const childSessions = new Map<string, OpenCodeDbSessionRow[]>()
  for (const row of rows) {
    if (!row.parentId) {
      continue
    }
    const root = roots.get(row.id) ?? row.id
    const siblings = childSessions.get(root) ?? []
    siblings.push(row)
    childSessions.set(root, siblings)
  }

  const [dbStat, walStat] = await Promise.all([
    stat(dbPath).catch(() => null),
    stat(`${dbPath}-wal`).catch(() => null),
  ])
  if (!dbStat) {
    return []
  }

  const descriptors: ExternalSessionDescriptor[] = []
  for (const row of rows) {
    if (row.parentId) {
      continue
    }
    const externalSessionId = `${dbPath}#${row.id}`
    const children = childSessions.get(row.id) ?? []
    // The database is one mutable file shared by every session, so the
    // revision combines the file identities (the WAL carries committed
    // writes) with the session's row statistics: a write elsewhere in the
    // database bumps the file times, a write to this session bumps the row
    // times, and either invalidates a captured preview.
    const sourceFiles: ExternalSessionSourceFile[] = [{
      path: dbPath,
      kind: 'main',
      sourceId: row.id,
      size: dbStat.size,
      modifiedAtMs: dbStat.mtimeMs,
    }]
    if (walStat?.isFile()) {
      sourceFiles.push({
        path: `${dbPath}-wal`,
        kind: 'main',
        sourceId: row.id,
        size: walStat.size,
        modifiedAtMs: walStat.mtimeMs,
      })
    }
    const latestChildUpdatedMs = children.reduce(
      (latest, child) => Math.max(latest, child.timeUpdated, child.lastMessageUpdated),
      0,
    )
    const updatedAtMs = Math.max(row.timeUpdated, row.lastMessageUpdated, latestChildUpdatedMs)
    const title = readOpenCodeDbSessionTitle(dbPath, row)
    descriptors.push({
      candidateId: createCandidateId({
        sourceHostId,
        sourceApp: 'opencode' as ExternalSessionDescriptor['sourceApp'],
        externalSessionId,
      }),
      sourceHostId,
      sourceApp: 'opencode' as ExternalSessionDescriptor['sourceApp'],
      externalSessionId,
      sourcePath: dbPath,
      sourceRevision: createSourceFilesRevision({
        externalSessionId: `${externalSessionId}\0${row.timeUpdated}\0${row.lastMessageUpdated}`,
        files: sourceFiles,
      }),
      title,
      summary: null,
      workspacePath: row.directory,
      gitIdentity: emptyGitIdentity(),
      createdAt: msToSeconds(row.timeCreated),
      updatedAt: msToSeconds(updatedAtMs),
      archived: false,
      estimatedBytes: dbStat.size,
      childSessionCount: children.length,
      sourceFiles,
    })
  }
  return descriptors
}

function readOpenCodeSessionRows(db: Database.Database): OpenCodeDbSessionRow[] {
  const rows: OpenCodeDbSessionRow[] = []
  const hasV2 = openCodeHasTable(db, 'session_v2')
  const hasV1 = openCodeHasTable(db, 'session')
  if (hasV2) {
    rows.push(...queryOpenCodeSessionRows(db, 'session_v2', 'session_message', '', 'v2'))
  }
  // Once migration completed only the new tables are read; while it is under
  // way, an old session not yet copied is read from the old ones (magpie
  // openCodeDBFilesIn).
  if (hasV1 && (!hasV2 || !openCodeMigrated(db))) {
    const where = hasV2 ? 'WHERE s.id NOT IN (SELECT id FROM session_v2)' : ''
    rows.push(...queryOpenCodeSessionRows(db, 'session', 'message', where, 'v1'))
  }
  return rows
}

function queryOpenCodeSessionRows(
  db: Database.Database,
  sessionTable: 'session_v2' | 'session',
  messageTable: 'session_message' | 'message',
  where: string,
  store: 'v2' | 'v1',
): OpenCodeDbSessionRow[] {
  const rows = db.prepare(`
    SELECT s.id, COALESCE(s.parent_id, ''), COALESCE(s.directory, ''), COALESCE(s.title, ''),
      s.time_created, s.time_updated, COALESCE(MAX(m.time_updated), 0)
    FROM ${sessionTable} s LEFT JOIN ${messageTable} m ON m.session_id = s.id
    ${where} GROUP BY s.id`).all() as Array<Record<string, unknown>>
  return rows.map((row) => {
    const values = Object.values(row)
    return {
      id: String(values[0]),
      parentId: String(values[1]),
      directory: String(values[2]),
      title: String(values[3]),
      timeCreated: Number(values[4]),
      timeUpdated: Number(values[5]),
      lastMessageUpdated: Number(values[6]),
      store,
    }
  })
}

function readOpenCodeDbSessionTitle(
  dbPath: string,
  row: OpenCodeDbSessionRow,
): string {
  const fallback = `OpenCode session ${row.id.slice(0, 8)}`
  if (row.title.trim() && !openCodeDefaultTitle(row.title)) {
    return compactText(row.title, 80)
  }
  const firstPrompt = withOpenCodeDatabase(dbPath, (db) => {
    if (row.store === 'v2') {
      // A user message's data is its prompt, {text, files, …} (magpie
      // opencode.go) — the first one in seq order is the title fallback.
      const firstUser = db.prepare(
        `SELECT data FROM session_message WHERE session_id = ? AND type = 'user' ORDER BY seq LIMIT 1`,
      ).get(row.id) as { data?: string | Buffer } | undefined
      if (!firstUser?.data) {
        return ''
      }
      const parsed = OpenCodeV2UserDataSchema.safeParse(parseJsonBytes(firstUser.data))
      return parsed.success ? parsed.data.text ?? '' : ''
    }
    const firstUser = db.prepare(
      `SELECT id FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user'
       ORDER BY json_extract(data, '$.time.created') LIMIT 1`,
    ).get(row.id) as { id?: string } | undefined
    if (!firstUser?.id) {
      return ''
    }
    return firstUserTextFromParts(
      (db.prepare(`SELECT data FROM part WHERE message_id = ? ORDER BY id`).all(firstUser.id) as Array<{ data: string | Buffer }>)
        .map(part => parseJsonBytes(part.data)),
    )
  })
  return titleFromText(firstPrompt ?? '', fallback)
}

function firstUserTextFromParts(parts: unknown[]): string {
  const typed: string[] = []
  for (const raw of parts) {
    const part = OpenCodePartSchema.safeParse(raw)
    // Only the words typed count for a title, not what OpenCode put in
    // beside them — a file read, a command's template (magpie ocTitle).
    if (!part.success || part.data.type !== 'text' || part.data.synthetic || part.data.ignored) {
      continue
    }
    if (part.data.text?.trim()) {
      typed.push(part.data.text)
    }
  }
  return typed.join(' ')
}

function openCodeDefaultTitle(title: string): boolean {
  return title.startsWith('New session - ') || title.startsWith('Child session - ')
}

function openCodeHasTable(db: Database.Database, name: string): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) as { count: number }
  return row.count > 0
}

function openCodeMigrated(db: Database.Database): boolean {
  if (!openCodeHasTable(db, 'kv')) {
    return false
  }
  const row = db.prepare(`SELECT value FROM kv WHERE key = ?`).get(OPENCODE_MIGRATION_KEY) as { value?: string | Buffer } | undefined
  if (!row?.value) {
    return false
  }
  try {
    const parsed = JSON.parse(String(row.value)) as { phase?: string }
    return parsed.phase === 'completed'
  }
  catch {
    return false
  }
}

function withOpenCodeDatabase<T>(
  dbPath: string,
  reader: (db: Database.Database) => T,
): T | null {
  let db: Database.Database | null = null
  try {
    db = new Database(dbPath)
    return reader(db)
  }
  catch {
    // A missing, locked, or corrupt database yields no sessions rather than
    // failing the whole scan.
    return null
  }
  finally {
    db?.close()
  }
}

function openCodeRootSessionId(sessionId: string, parent: ReadonlyMap<string, string>): string {
  // A subagent's subagent counts under the root session too (magpie ocRoots).
  let root = sessionId
  for (let depth = 0; depth < OPENCODE_PARENT_WALK_LIMIT; depth += 1) {
    const next = parent.get(root)
    if (!next) {
      break
    }
    root = next
  }
  return root
}

// ---- legacy JSON file discovery ----------------------------------------------

async function discoverOpenCodeLegacySessions(
  storageRoot: string,
  sourceHostId: string,
): Promise<ExternalSessionDescriptor[]> {
  const sessionFiles = await listJsonFilesRecursive(join(storageRoot, 'session'))
  const sessions: OpenCodeLegacySession[] = []
  const parent = new Map<string, string>()
  for (const sessionPath of sessionFiles) {
    const content = await readFile(sessionPath, 'utf8').catch(() => null)
    if (!content) {
      continue
    }
    const parsed = OpenCodeV1SessionSchema.safeParse(safeJsonValue(content))
    if (!parsed.success) {
      continue
    }
    const info = parsed.data
    parent.set(info.id, info.parentID ?? '')
    const sessionStat = await stat(sessionPath)
    const files: ExternalSessionSourceFile[] = [{
      path: sessionPath,
      kind: 'main',
      sourceId: info.id,
      size: sessionStat.size,
      modifiedAtMs: sessionStat.mtimeMs,
    }]
    let updatedAtMs = sessionStat.mtimeMs
    // Messages and parts of this session are captured with it, so their
    // identity participates in the revision — a message's file is written
    // again as its reply goes on (magpie openCodeJSONFiles).
    const messageFiles = await listJsonFiles(join(storageRoot, 'message', info.id))
    const partFiles: string[] = []
    for (const messagePath of messageFiles) {
      partFiles.push(...await listJsonFiles(join(storageRoot, 'part', basename(messagePath, '.json'))))
    }
    for (const path of [...messageFiles, ...partFiles]) {
      const fileStat = await stat(path).catch(() => null)
      if (!fileStat?.isFile()) {
        continue
      }
      updatedAtMs = Math.max(updatedAtMs, fileStat.mtimeMs)
      files.push({
        path,
        kind: 'main',
        sourceId: info.id,
        size: fileStat.size,
        modifiedAtMs: fileStat.mtimeMs,
      })
    }
    sessions.push({ info, files, updatedAtMs })
  }

  const roots = new Map(sessions.map(session => [
    session.info.id,
    openCodeRootSessionId(session.info.id, parent),
  ]))
  const childSessions = new Map<string, OpenCodeLegacySession[]>()
  for (const session of sessions) {
    if (!(session.info.parentID ?? '')) {
      continue
    }
    const root = roots.get(session.info.id) ?? session.info.id
    const siblings = childSessions.get(root) ?? []
    siblings.push(session)
    childSessions.set(root, siblings)
  }

  const descriptors: ExternalSessionDescriptor[] = []
  for (const session of sessions) {
    if (session.info.parentID) {
      continue
    }
    const children = childSessions.get(session.info.id) ?? []
    const sourceFiles = [
      ...session.files,
      ...children.flatMap(child => child.files.map(file => ({ ...file, kind: 'subagent' as const }))),
    ]
    const updatedAtMs = Math.max(
      session.updatedAtMs,
      ...children.map(child => child.updatedAtMs),
      0,
    )
    const externalSessionId = session.info.id
    const title = await readOpenCodeLegacySessionTitle(storageRoot, session)
    descriptors.push({
      candidateId: createCandidateId({
        sourceHostId,
        sourceApp: 'opencode' as ExternalSessionDescriptor['sourceApp'],
        externalSessionId,
      }),
      sourceHostId,
      sourceApp: 'opencode' as ExternalSessionDescriptor['sourceApp'],
      externalSessionId,
      sourcePath: session.files[0]?.path ?? null,
      sourceRevision: createSourceFilesRevision({ externalSessionId, files: sourceFiles }),
      title,
      summary: null,
      workspacePath: session.info.directory ?? '',
      gitIdentity: emptyGitIdentity(),
      createdAt: msToSeconds(session.info.time?.created ?? 0),
      updatedAt: msToSeconds(updatedAtMs),
      archived: false,
      estimatedBytes: sourceFiles.reduce((total, file) => total + file.size, 0),
      childSessionCount: children.length,
      sourceFiles,
    })
  }
  return descriptors
}

async function readOpenCodeLegacySessionTitle(
  storageRoot: string,
  session: OpenCodeLegacySession,
): Promise<string> {
  const fallback = `OpenCode session ${session.info.id.slice(0, 8)}`
  const storedTitle = session.info.title ?? ''
  if (storedTitle.trim() && !openCodeDefaultTitle(storedTitle)) {
    return compactText(storedTitle, 80)
  }
  const messageFiles = await listJsonFiles(join(storageRoot, 'message', session.info.id))
  interface LegacyMessageRef { id: string, created: number, role: string }
  const messages: LegacyMessageRef[] = []
  for (const path of messageFiles) {
    const content = await readFile(path, 'utf8').catch(() => null)
    if (!content) {
      continue
    }
    const parsed = OpenCodeV1MessageSchema.safeParse(safeJsonValue(content))
    if (parsed.success) {
      messages.push({
        id: basename(path, '.json'),
        created: parsed.data.time?.created ?? 0,
        role: parsed.data.role,
      })
    }
  }
  messages.sort((left, right) => left.created - right.created || left.id.localeCompare(right.id))
  const firstUser = messages.find(message => message.role === 'user')
  if (!firstUser) {
    return fallback
  }
  const parts: unknown[] = []
  for (const path of await listJsonFiles(join(storageRoot, 'part', firstUser.id))) {
    const content = await readFile(path, 'utf8').catch(() => null)
    if (content) {
      parts.push(safeJsonValue(content))
    }
  }
  return titleFromText(firstUserTextFromParts(parts), fallback)
}

async function listJsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => join(directory, entry.name))
    .sort()
}

async function listJsonFilesRecursive(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listJsonFilesRecursive(path))
    }
    else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(path)
    }
  }
  return files.sort()
}

// ---- capture -----------------------------------------------------------------

async function captureOpenCodeSession(
  descriptor: ExternalSessionDescriptor,
): Promise<ExternalSessionBundle> {
  const dbFile = descriptor.sourceFiles.find(file => file.path.endsWith('.db'))
  if (dbFile) {
    return await captureOpenCodeDatabaseSession(descriptor, dbFile.path)
  }
  return await captureOpenCodeLegacySession(descriptor)
}

const openCodeBundleOps = {
  async begin(
    descriptor: ExternalSessionDescriptor,
  ): Promise<{ storagePath: string, absolutePath: string, temporaryPath: string, existing: ExternalSessionBundle | null }> {
    const storagePath = join(
      'external-session-import',
      descriptor.sourceApp,
      descriptor.candidateId,
      descriptor.sourceRevision,
    )
    const absolutePath = resolveOpenCodeImportStoragePath(storagePath)
    const existing = await readOpenCodeBundleIfPresent(storagePath, absolutePath, descriptor)
    const temporaryPath = `${absolutePath}.tmp-${process.pid}-${Date.now()}`
    return { storagePath, absolutePath, temporaryPath, existing }
  },
  async publish(
    descriptor: ExternalSessionDescriptor,
    paths: { storagePath: string, absolutePath: string, temporaryPath: string },
    files: ExternalSessionBundleFile[],
  ): Promise<ExternalSessionBundle> {
    const manifest: ExternalSessionBundleManifest = {
      version: 1,
      parserVersion: EXTERNAL_SESSION_IMPORT_PARSER_VERSION,
      sourceHostId: descriptor.sourceHostId,
      sourceApp: descriptor.sourceApp,
      externalSessionId: descriptor.externalSessionId,
      sourceRevision: descriptor.sourceRevision,
      capturedAt: Math.floor(Date.now() / 1000),
      files,
    }
    await writeFile(join(paths.temporaryPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    })
    await mkdir(dirname(paths.absolutePath), { recursive: true })
    await rename(paths.temporaryPath, paths.absolutePath)
    return { storagePath: paths.storagePath, absolutePath: paths.absolutePath, manifest, created: true }
  },
  async abandon(
    descriptor: ExternalSessionDescriptor,
    paths: { storagePath: string, absolutePath: string, temporaryPath: string },
    error: unknown,
  ): Promise<never> {
    await rm(paths.temporaryPath, { recursive: true, force: true })
    throw error
  },
}

/**
 * A live SQLite database is one mutable file, so a byte-wise copy is not a
 * consistent snapshot. better-sqlite3's serialize() reads the database image
 * through SQLite's own locking, producing consistent bytes; the image is then
 * filtered to the selected session tree and written as gzip members with the
 * same verify-then-publish semantics as the shared file capture.
 */
async function captureOpenCodeDatabaseSession(
  descriptor: ExternalSessionDescriptor,
  dbPath: string,
): Promise<ExternalSessionBundle> {
  const paths = await openCodeBundleOps.begin(descriptor)
  if (paths.existing) {
    return paths.existing
  }
  await mkdir(join(paths.temporaryPath, 'source'), { recursive: true })
  try {
    await assertOpenCodeDbRevisionUnchanged(descriptor, dbPath)
    const mainSessionId = openCodeMainSessionId(descriptor)
    const snapshot = snapshotOpenCodeSessionDatabase(dbPath, mainSessionId)
    await assertOpenCodeDbRevisionUnchanged(descriptor, dbPath)

    const hash = createHash('sha256').update(snapshot).digest('hex')
    const bundlePath = join('source', '000-main.opencode.db.gz')
    await writeFile(join(paths.temporaryPath, bundlePath), gzipSync(snapshot), { flag: 'wx' })
    return await openCodeBundleOps.publish(descriptor, paths, [{
      sourcePath: dbPath,
      bundlePath,
      kind: 'main',
      sourceId: mainSessionId,
      size: snapshot.byteLength,
      sha256: hash,
    }])
  }
  catch (error) {
    return await openCodeBundleOps.abandon(descriptor, paths, error)
  }
}

/**
 * Legacy storage/ JSON files are immutable like the reference adapters'
 * transcripts, but the bundle must preserve their storage-relative layout
 * (message/<session>/<id>.json, part/<message>/<id>.json) so reads can
 * attribute parts to messages. The streaming copy therefore mirrors the
 * shared capture with a layout-preserving member name.
 */
async function captureOpenCodeLegacySession(
  descriptor: ExternalSessionDescriptor,
): Promise<ExternalSessionBundle> {
  const paths = await openCodeBundleOps.begin(descriptor)
  if (paths.existing) {
    return paths.existing
  }
  await mkdir(join(paths.temporaryPath, 'source'), { recursive: true })
  try {
    const files: ExternalSessionBundleFile[] = []
    for (const [index, source] of descriptor.sourceFiles.entries()) {
      const before = await stat(source.path)
      assertOpenCodeSourceFileUnchanged(source.path, source.size, source.modifiedAtMs, before.size, before.mtimeMs)
      const layoutPath = openCodeStorageRelativePath(source.path)
      const fileName = `${String(index).padStart(3, '0')}-${layoutPath}.gz`
      const bundlePath = join('source', fileName)
      const outputPath = join(paths.temporaryPath, bundlePath)
      await mkdir(dirname(outputPath), { recursive: true })
      const hash = createHash('sha256')
      const hasher = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(
        createReadStream(source.path),
        hasher,
        createGzip(),
        createWriteStream(outputPath, { flags: 'wx' }),
      )
      const after = await stat(source.path)
      assertOpenCodeSourceFileUnchanged(source.path, source.size, source.modifiedAtMs, after.size, after.mtimeMs)
      files.push({
        sourcePath: source.path,
        bundlePath,
        kind: source.kind,
        sourceId: source.sourceId,
        size: source.size,
        sha256: hash.digest('hex'),
      })
    }

    const observedRevision = createSourceFilesRevision({
      externalSessionId: descriptor.externalSessionId,
      files: descriptor.sourceFiles,
    })
    if (observedRevision !== descriptor.sourceRevision) {
      throw new Error('External session source changed after preview; scan again before importing')
    }
    return await openCodeBundleOps.publish(descriptor, paths, files)
  }
  catch (error) {
    return await openCodeBundleOps.abandon(descriptor, paths, error)
  }
}

/**
 * Derives the storage-relative path (session/…, message/…, part/…) of a
 * legacy JSON file; falls back to its base name when the file does not live
 * under an OpenCode storage layout.
 */
function openCodeStorageRelativePath(path: string): string {
  const segments = path.split(sep)
  const storageIndex = segments.lastIndexOf('storage')
  if (storageIndex >= 0 && storageIndex < segments.length - 1) {
    return segments.slice(storageIndex + 1).join('/')
  }
  return basename(path)
}

async function assertOpenCodeDbRevisionUnchanged(
  descriptor: ExternalSessionDescriptor,
  dbPath: string,
): Promise<void> {
  const observed = await observeOpenCodeDbRevision(descriptor, dbPath)
  if (observed !== descriptor.sourceRevision) {
    throw new Error('External session source changed after preview; scan again before importing')
  }
}

async function observeOpenCodeDbRevision(
  descriptor: ExternalSessionDescriptor,
  dbPath: string,
): Promise<string> {
  const mainSessionId = openCodeMainSessionId(descriptor)
  const row = withOpenCodeDatabase(dbPath, db => readOpenCodeSessionRows(db).find(candidate => candidate.id === mainSessionId))
  if (!row) {
    throw new Error(`OpenCode session ${mainSessionId} no longer exists in ${dbPath}`)
  }
  const files: ExternalSessionSourceFile[] = []
  for (const path of [dbPath, `${dbPath}-wal`]) {
    const fileStat = await stat(path).catch(() => null)
    if (fileStat?.isFile()) {
      files.push({
        path,
        kind: 'main',
        sourceId: mainSessionId,
        size: fileStat.size,
        modifiedAtMs: fileStat.mtimeMs,
      })
    }
  }
  return createSourceFilesRevision({
    externalSessionId: `${descriptor.externalSessionId}\0${row.timeUpdated}\0${row.lastMessageUpdated}`,
    files,
  })
}

function openCodeMainSessionId(descriptor: ExternalSessionDescriptor): string {
  const hashIndex = descriptor.externalSessionId.indexOf('#')
  return hashIndex >= 0 ? descriptor.externalSessionId.slice(hashIndex + 1) : descriptor.externalSessionId
}

/**
 * Produces a checkpointed database image holding only the selected session
 * and its subagent tree. Capturing the whole user database would copy
 * unrelated session content into every imported bundle.
 */
function snapshotOpenCodeSessionDatabase(dbPath: string, mainSessionId: string): Buffer {
  const source = new Database(dbPath)
  try {
    const rows = readOpenCodeSessionRows(source)
    const parent = new Map(rows.map(row => [row.id, row.parentId]))
    const keep = new Set<string>()
    for (const row of rows) {
      if (openCodeRootSessionId(row.id, parent) === mainSessionId) {
        keep.add(row.id)
      }
    }
    keep.add(mainSessionId)
    const snapshot = source.serialize()
    const copy = new Database(snapshot)
    try {
      const dropSessions = (sessionTable: string, messageTable: string) => {
        if (!openCodeHasTable(copy, sessionTable) || !openCodeHasTable(copy, messageTable)) {
          return
        }
        const ids = (copy.prepare(`SELECT id FROM ${sessionTable}`).all() as Array<{ id: string }>)
          .map(row => row.id)
          .filter(id => !keep.has(id))
        const deleteMessages = copy.prepare(`DELETE FROM ${messageTable} WHERE session_id = ?`)
        const deleteSession = copy.prepare(`DELETE FROM ${sessionTable} WHERE id = ?`)
        for (const id of ids) {
          deleteMessages.run(id)
          deleteSession.run(id)
        }
      }
      dropSessions('session_v2', 'session_message')
      dropSessions('session', 'message')
      if (openCodeHasTable(copy, 'part') && openCodeHasTable(copy, 'message')) {
        copy.exec(`DELETE FROM part WHERE message_id NOT IN (SELECT id FROM message)`)
      }
      copy.exec('VACUUM')
      return copy.serialize()
    }
    finally {
      copy.close()
    }
  }
  finally {
    source.close()
  }
}

function resolveOpenCodeImportStoragePath(storagePath: string): string {
  const config = getServerConfig()
  const dataRoot = resolve(config.dataDir ?? dirname(config.dbPath))
  const absolutePath = resolve(dataRoot, storagePath)
  if (relative(dataRoot, absolutePath).startsWith('..')) {
    throw new Error('External session bundle path escapes the Cradle data directory')
  }
  return absolutePath
}

async function readOpenCodeBundleIfPresent(
  storagePath: string,
  absolutePath: string,
  descriptor: ExternalSessionDescriptor,
): Promise<ExternalSessionBundle | null> {
  let manifestJson: string
  try {
    manifestJson = await readFile(join(absolutePath, 'manifest.json'), 'utf8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  const manifest = OpenCodeBundleManifestSchema.parse(JSON.parse(manifestJson)) as unknown as ExternalSessionBundleManifest
  if (manifest.sourceHostId !== descriptor.sourceHostId
    || manifest.sourceApp !== descriptor.sourceApp
    || manifest.externalSessionId !== descriptor.externalSessionId
    || manifest.sourceRevision !== descriptor.sourceRevision) {
    throw new Error('External session bundle identity does not match its source descriptor')
  }
  return { storagePath, absolutePath, manifest, created: false }
}

function assertOpenCodeSourceFileUnchanged(
  path: string,
  expectedSize: number,
  expectedModifiedAtMs: number,
  actualSize: number,
  actualModifiedAtMs: number,
): void {
  if (actualSize !== expectedSize || actualModifiedAtMs !== expectedModifiedAtMs) {
    throw new Error(`External session source changed after preview: ${path}`)
  }
}

// ---- read --------------------------------------------------------------------

async function readOpenCodeSession(
  descriptor: ExternalSessionDescriptor,
  bundle: ExternalSessionBundle,
): Promise<ExternalSessionReadResult> {
  const dbMember = bundle.manifest.files.find(file => file.bundlePath.endsWith('.db.gz'))
  if (dbMember) {
    return await readOpenCodeDatabaseBundle(descriptor, bundle, dbMember)
  }
  return await readOpenCodeLegacyBundle(descriptor, bundle)
}

async function readOpenCodeDatabaseBundle(
  descriptor: ExternalSessionDescriptor,
  bundle: ExternalSessionBundle,
  dbMember: ExternalSessionBundleFile,
): Promise<ExternalSessionReadResult> {
  const fidelity = emptyOpenCodeFidelity(descriptor)
  // better-sqlite3 opens files, not streams, so the integrity-verified bytes
  // land in a scratch file that is removed after the projection; the bundle
  // remains the only durable copy.
  const scratch = await mkdtemp(join(tmpdir(), 'cradle-opencode-bundle-'))
  try {
    const scratchPath = join(scratch, 'snapshot.db')
    await pipeline(openExternalSessionBundleFile(bundle, dbMember), createWriteStream(scratchPath))
    const messages = withOpenCodeDatabase(scratchPath, db => readOpenCodeNormalizedMessages(db, descriptor, fidelity)) ?? []
    return finishOpenCodeRead(descriptor, messages, fidelity)
  }
  finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

function readOpenCodeNormalizedMessages(
  db: Database.Database,
  descriptor: ExternalSessionDescriptor,
  fidelity: ExternalSessionFidelityReport,
): OpenCodeNormalizedMessage[] {
  const mainSessionId = openCodeMainSessionId(descriptor)
  const hasV2 = openCodeHasTable(db, 'session_v2')
    && (db.prepare(`SELECT COUNT(*) AS count FROM session_v2 WHERE id = ?`).get(mainSessionId) as { count: number }).count > 0
  if (hasV2) {
    return readOpenCodeV2Messages(db, mainSessionId, fidelity)
  }
  return readOpenCodeV1Messages(db, mainSessionId, fidelity)
}

function readOpenCodeV2Messages(
  db: Database.Database,
  sessionId: string,
  fidelity: ExternalSessionFidelityReport,
): OpenCodeNormalizedMessage[] {
  const normalized: OpenCodeNormalizedMessage[] = []
  const rows = db.prepare(
    `SELECT id, type, data, COALESCE(time_created, 0) AS row_created FROM session_message WHERE session_id = ? ORDER BY seq`,
  ).all(sessionId) as Array<{ id: string, type: string, data: string | Buffer, row_created: number }>
  for (const row of rows) {
    if (row.type === 'user') {
      const parsed = OpenCodeV2UserDataSchema.safeParse(parseJsonBytes(row.data))
      if (!parsed.success) {
        fidelity.preservedUnknownEntries += 1
        continue
      }
      normalized.push({
        id: row.id,
        role: 'user',
        createdMs: row.row_created || readV2CreatedMs(parseJsonBytes(row.data)),
        userText: parsed.data.text ?? '',
        files: parsed.data.files ?? [],
        parts: [],
      })
      continue
    }
    if (row.type === 'assistant') {
      const parsed = OpenCodeV2AssistantDataSchema.safeParse(parseJsonBytes(row.data))
      if (!parsed.success) {
        fidelity.preservedUnknownEntries += 1
        continue
      }
      const parts: Array<z.infer<typeof OpenCodePartSchema>> = []
      for (const content of parsed.data.content ?? []) {
        const part = OpenCodePartSchema.safeParse(content)
        if (part.success) {
          parts.push(part.data)
        }
        else {
          fidelity.preservedUnknownEntries += 1
        }
      }
      normalized.push({
        id: row.id,
        role: 'assistant',
        createdMs: parsed.data.time?.created ?? row.row_created ?? 0,
        userText: '',
        files: [],
        parts,
      })
      continue
    }
    // synthetic/system/compaction/idle rows carry no user-visible
    // conversation; like the reference adapters' non-conversation entries
    // they are counted but not projected.
    if (row.type === 'compaction' || row.type === 'skill' || row.type === 'synthetic' || row.type === 'system') {
      fidelity.omittedSystemEntries += 1
    }
    else {
      fidelity.preservedUnknownEntries += 1
    }
  }
  return normalized
}

function readV2CreatedMs(data: unknown): number {
  if (typeof data === 'object' && data !== null) {
    const time = (data as { time?: { created?: number } }).time
    return time?.created ?? 0
  }
  return 0
}

function readOpenCodeV1Messages(
  db: Database.Database,
  sessionId: string,
  fidelity: ExternalSessionFidelityReport,
): OpenCodeNormalizedMessage[] {
  interface V1Row { id: string, role: string, createdMs: number }
  const rows = db.prepare(`SELECT data FROM message WHERE session_id = ?`).all(sessionId) as Array<{ data: string | Buffer }>
  const parsedRows: V1Row[] = []
  rows.forEach((row, index) => {
    const parsed = OpenCodeV1MessageSchema.safeParse(parseJsonBytes(row.data))
    if (!parsed.success) {
      fidelity.preservedUnknownEntries += 1
      return
    }
    parsedRows.push({
      id: parsed.data.id ?? `row-${index}`,
      role: parsed.data.role,
      createdMs: parsed.data.time?.created ?? 0,
    })
  })
  // Messages are read in creation order like magpie parseOpenCode; the table
  // itself has no ordering guarantee.
  parsedRows.sort((left, right) => left.createdMs - right.createdMs || left.id.localeCompare(right.id))
  const normalized: OpenCodeNormalizedMessage[] = []
  for (const row of parsedRows) {
    if (row.role !== 'user' && row.role !== 'assistant') {
      fidelity.omittedSystemEntries += 1
      continue
    }
    const partRows = db.prepare(`SELECT data FROM part WHERE message_id = ? ORDER BY id`).all(row.id) as Array<{ data: string | Buffer }>
    const parts: Array<z.infer<typeof OpenCodePartSchema>> = []
    for (const partRow of partRows) {
      const part = OpenCodePartSchema.safeParse(parseJsonBytes(partRow.data))
      if (part.success) {
        parts.push(part.data)
      }
      else {
        fidelity.preservedUnknownEntries += 1
      }
    }
    normalized.push({
      id: row.id,
      role: row.role,
      createdMs: row.createdMs,
      userText: '',
      files: [],
      parts,
    })
  }
  return normalized
}

async function readOpenCodeLegacyBundle(
  descriptor: ExternalSessionDescriptor,
  bundle: ExternalSessionBundle,
): Promise<ExternalSessionReadResult> {
  const fidelity = emptyOpenCodeFidelity(descriptor)
  const mainFiles = bundle.manifest.files.filter(file => file.kind === 'main')
  interface LegacyMessageDoc {
    id: string
    role: string
    createdMs: number
    parts: Array<z.infer<typeof OpenCodePartSchema>>
  }
  const messages = new Map<string, LegacyMessageDoc>()
  const pendingParts: Array<{ messageId: string, part: z.infer<typeof OpenCodePartSchema> }> = []
  for (const file of mainFiles) {
    const layoutPath = file.bundlePath.replace(/^source\//, '').replace(/^\d+-/, '').replace(/\.gz$/, '')
    const segments = layoutPath.split('/')
    if (segments[0] !== 'message' && segments[0] !== 'part') {
      continue
    }
    const bytes = await readVerifiedMemberBytes(bundle, file)
    if (segments[0] === 'message' && segments[1] === descriptor.externalSessionId) {
      const parsed = OpenCodeV1MessageSchema.safeParse(parseJsonBytes(bytes))
      if (!parsed.success) {
        fidelity.preservedUnknownEntries += 1
        continue
      }
      const id = parsed.data.id ?? basename(layoutPath, '.json')
      messages.set(id, {
        id,
        role: parsed.data.role,
        createdMs: parsed.data.time?.created ?? 0,
        parts: [],
      })
      continue
    }
    if (segments[0] === 'part' && segments.length >= 3) {
      const part = OpenCodePartSchema.safeParse(parseJsonBytes(bytes))
      if (!part.success) {
        fidelity.preservedUnknownEntries += 1
        continue
      }
      const messageId = segments[1]!
      const target = messages.get(messageId)
      if (target) {
        target.parts.push(part.data)
      }
      else {
        // Manifest order is discovery order, not layout order; a part may be
        // read before its message row.
        pendingParts.push({ messageId, part: part.data })
      }
    }
  }
  for (const pending of pendingParts) {
    messages.get(pending.messageId)?.parts.push(pending.part)
  }
  const ordered = [...messages.values()]
    .sort((left, right) => left.createdMs - right.createdMs || left.id.localeCompare(right.id))
  const normalized: OpenCodeNormalizedMessage[] = []
  for (const message of ordered) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      fidelity.omittedSystemEntries += 1
      continue
    }
    normalized.push({
      id: message.id,
      role: message.role,
      createdMs: message.createdMs,
      userText: '',
      files: [],
      parts: message.parts,
    })
  }
  return finishOpenCodeRead(descriptor, normalized, fidelity)
}

function finishOpenCodeRead(
  descriptor: ExternalSessionDescriptor,
  normalized: OpenCodeNormalizedMessage[],
  fidelity: ExternalSessionFidelityReport,
): ExternalSessionReadResult {
  const messages: ExternalSessionImportMessage[] = []
  for (const row of normalized) {
    const sourceEntryId = `message-${row.id}`
    const createdAt = msToSeconds(row.createdMs)
    if (row.role === 'user') {
      const text = row.userText || row.parts
        .filter(part => part.type === 'text' && !part.synthetic && !part.ignored)
        .map(part => part.text ?? '')
        .filter(Boolean)
        .join('\n')
      fidelity.omittedSystemEntries += row.parts
        .filter(part => part.type === 'text' && (part.synthetic || part.ignored))
        .length
      fidelity.unavailableAttachments += row.files.length + row.parts
        .filter(part => part.type === 'file')
        .length
      if (!text.trim()) {
        continue
      }
      messages.push(importedMessage({
        id: importedOpenCodeMessageId(descriptor, sourceEntryId),
        role: 'user',
        parts: [{ type: 'text', text }],
        sourceEntryIds: [sourceEntryId],
        createdAt,
        descriptor,
      }))
      continue
    }
    const parts: UIMessage['parts'] = []
    for (const part of row.parts) {
      if (part.synthetic || part.ignored) {
        fidelity.omittedSystemEntries += 1
        continue
      }
      if (part.type === 'text') {
        if (part.text) {
          parts.push({ type: 'text', text: part.text })
        }
        continue
      }
      if (part.type === 'reasoning') {
        if (part.text) {
          parts.push({ type: 'reasoning', text: part.text } as UIMessage['parts'][number])
          fidelity.reasoningParts += 1
        }
        continue
      }
      if (part.type === 'tool') {
        parts.push(projectOpenCodeToolPart(part))
        fidelity.toolCalls += 1
        continue
      }
      if (part.type === 'file' || part.type === 'patch' || part.type === 'snapshot' || part.type === 'step-start') {
        fidelity.unavailableAttachments += 1
        continue
      }
      fidelity.preservedUnknownEntries += 1
    }
    if (parts.length === 0) {
      continue
    }
    messages.push(importedMessage({
      id: importedOpenCodeMessageId(descriptor, sourceEntryId),
      role: 'assistant',
      parts,
      sourceEntryIds: [sourceEntryId],
      createdAt,
      descriptor,
    }))
  }
  fidelity.messages = messages.length
  return {
    descriptor,
    contentHash: createContentHash(messages),
    messages,
    fidelity,
  }
}

function projectOpenCodeToolPart(
  part: z.infer<typeof OpenCodePartSchema>,
): UIMessage['parts'][number] {
  // A part names its tool in name, older ones in tool (magpie
  // openCodeTranscriptPart); input/output live in state, with the output
  // either a string or content entries.
  const name = part.name ?? part.tool ?? 'unknown'
  const toolCallId = part.callID ?? part.id ?? `${name}-unknown`
  const input = typeof part.state?.input === 'string'
    ? safeJsonValue(part.state.input)
    : part.state?.input ?? {}
  const output = readOpenCodeToolOutput(part)
  const status = part.state?.status ?? ''
  if (status === 'error') {
    return {
      type: `tool-${name}`,
      toolCallId,
      state: 'output-error',
      input,
      errorText: typeof part.state?.error === 'string' ? part.state.error : String(output ?? ''),
    } as UIMessage['parts'][number]
  }
  if (status === 'completed' && output !== undefined) {
    return {
      type: `tool-${name}`,
      toolCallId,
      state: 'output-available',
      input,
      output,
    } as UIMessage['parts'][number]
  }
  return {
    type: `tool-${name}`,
    toolCallId,
    state: 'input-available',
    input,
  } as UIMessage['parts'][number]
}

function readOpenCodeToolOutput(part: z.infer<typeof OpenCodePartSchema>): unknown {
  const state = part.state
  if (!state) {
    return undefined
  }
  if (typeof state.output === 'string' && state.output) {
    return state.output
  }
  if (state.output !== undefined && state.output !== null && typeof state.output !== 'string') {
    return state.output
  }
  const texts = (state.content ?? [])
    .filter(entry => entry.type === 'text' && entry.text)
    .map(entry => entry.text)
  if (texts.length > 0) {
    return texts.join('\n')
  }
  return typeof state.output === 'string' && state.output ? state.output : undefined
}

function emptyOpenCodeFidelity(descriptor: ExternalSessionDescriptor): ExternalSessionFidelityReport {
  return {
    messages: 0,
    toolCalls: 0,
    reasoningParts: 0,
    omittedSystemEntries: 0,
    unavailableAttachments: 0,
    childSessions: descriptor.childSessionCount ?? 0,
    preservedUnknownEntries: 0,
  }
}

async function readVerifiedMemberBytes(
  bundle: ExternalSessionBundle,
  file: ExternalSessionBundleFile,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of openExternalSessionBundleFile(bundle, file)) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function parseJsonBytes(data: string | Buffer): unknown {
  try {
    return JSON.parse(typeof data === 'string' ? data : data.toString('utf8'))
  }
  catch {
    return null
  }
}

function importedOpenCodeMessageId(
  descriptor: ExternalSessionDescriptor,
  sourceEntryId: string,
): string {
  return createImportedMessageId({
    sourceApp: descriptor.sourceApp,
    externalSessionId: descriptor.externalSessionId,
    sourceEntryId,
  })
}

function msToSeconds(ms: number): number | null {
  return ms > 0 ? Math.floor(ms / 1000) : null
}

async function isRegularFile(path: string): Promise<boolean> {
  const fileStat = await stat(path).catch(() => null)
  return fileStat?.isFile() ?? false
}
