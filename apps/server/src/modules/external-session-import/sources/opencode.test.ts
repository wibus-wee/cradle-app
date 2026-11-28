import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { openExternalSessionBundleFile } from '../bundle-store'
import { createOpenCodeSessionSource } from './opencode'

const tempDirectories: string[] = []
const previousDataDir = process.env.CRADLE_DATA_DIR

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
})

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempDirectories.push(root)
  process.env.CRADLE_DATA_DIR = join(root, 'data')
  return root
}

async function readBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

// ---- fixture builders: schema shapes follow magpie internal/sessions/opencode.go

function createOpenCodeDb(path: string, options: { v2?: boolean, migrated?: boolean }): Database.Database {
  const db = new Database(path)
  if (options.v2) {
    db.exec(`
      CREATE TABLE session_v2 (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        directory TEXT,
        title TEXT,
        time_created INTEGER,
        time_updated INTEGER
      );
      CREATE TABLE session_message (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        type TEXT,
        seq INTEGER,
        data TEXT,
        time_created INTEGER,
        time_updated INTEGER
      );
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);
    `)
  }
  else {
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        directory TEXT,
        title TEXT,
        time_created INTEGER,
        time_updated INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        data TEXT,
        time_created INTEGER,
        time_updated INTEGER
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        data TEXT,
        time_created INTEGER,
        time_updated INTEGER
      );
    `)
  }
  if (options.v2 && options.migrated !== undefined) {
    db.prepare(`INSERT INTO kv (key, value) VALUES ('migration.v1-v2', ?)`)
      .run(JSON.stringify({ phase: options.migrated ? 'completed' : 'copying' }))
  }
  return db
}

function insertV2Session(db: Database.Database, input: {
  id: string
  parentId?: string
  directory?: string
  title?: string | null
  created?: number
  updated?: number
}): void {
  db.prepare(`INSERT INTO session_v2 (id, parent_id, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(input.id, input.parentId ?? null, input.directory ?? '/workspace/project', input.title ?? null, input.created ?? 1_800_000_000_000, input.updated ?? 1_800_000_100_000)
}

function insertV2Message(db: Database.Database, input: {
  id: string
  sessionId: string
  type: string
  seq: number
  data: unknown
}): void {
  db.prepare(`INSERT INTO session_message (id, session_id, type, seq, data, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(input.id, input.sessionId, input.type, input.seq, JSON.stringify(input.data), 1_800_000_000_000 + input.seq * 1000, 1_800_000_000_000 + input.seq * 1000)
}

function insertV1Session(db: Database.Database, input: {
  id: string
  parentId?: string
  directory?: string
  title?: string
  created?: number
  updated?: number
}): void {
  db.prepare(`INSERT INTO session (id, parent_id, directory, title, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(input.id, input.parentId ?? null, input.directory ?? '/workspace/project', input.title ?? '', input.created ?? 1_800_000_000_000, input.updated ?? 1_800_000_100_000)
}

function insertV1Message(db: Database.Database, input: {
  id: string
  sessionId: string
  data: unknown
}): void {
  const created = (input.data as { time?: { created?: number } }).time?.created ?? 0
  db.prepare(`INSERT INTO message (id, session_id, data, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`)
    .run(input.id, input.sessionId, JSON.stringify(input.data), created, created)
}

function insertV1Part(db: Database.Database, input: {
  id: string
  messageId: string
  data: unknown
}): void {
  db.prepare(`INSERT INTO part (id, message_id, data, time_created, time_updated) VALUES (?, ?, ?, ?, ?)`)
    .run(input.id, input.messageId, JSON.stringify(input.data), 0, 0)
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

describe('opencode session source adapter', () => {
  it('discovers v2 database sessions, captures a filtered consistent snapshot, and projects messages', async () => {
    const root = makeTempRoot('cradle-opencode-v2-')
    const dataDir = join(root, 'opencode')
    mkdirSync(dataDir, { recursive: true })
    const db = createOpenCodeDb(join(dataDir, 'opencode.db'), { v2: true, migrated: true })
    insertV2Session(db, { id: 'oc-main', title: 'Investigate import' })
    insertV2Session(db, { id: 'oc-child', parentId: 'oc-main' })
    insertV2Session(db, { id: 'oc-other', title: 'Unrelated session' })
    insertV2Message(db, {
      id: 'msg-u1',
      sessionId: 'oc-main',
      type: 'user',
      seq: 0,
      data: { text: 'Add OpenCode import support', files: [] },
    })
    insertV2Message(db, {
      id: 'msg-a1',
      sessionId: 'oc-main',
      type: 'assistant',
      seq: 1,
      data: {
        model: { id: 'claude-sonnet-4', providerID: 'anthropic' },
        time: { created: 1_800_000_001_000, completed: 1_800_000_005_000 },
        content: [
          { type: 'reasoning', text: 'Thinking about sqlite snapshots' },
          {
            type: 'tool',
            name: 'bash',
            id: 'part-tool-1',
            state: { status: 'completed', input: { command: 'ls' }, output: 'opencode.db' },
          },
          { type: 'text', text: 'Import support added.' },
        ],
      },
    })
    insertV2Message(db, {
      id: 'msg-sys',
      sessionId: 'oc-main',
      type: 'compaction',
      seq: 2,
      data: { tokens: {} },
    })
    insertV2Message(db, {
      id: 'msg-other',
      sessionId: 'oc-other',
      type: 'user',
      seq: 0,
      data: { text: 'unrelated prompt that must not leak', files: [] },
    })
    insertV2Message(db, {
      id: 'msg-child',
      sessionId: 'oc-child',
      type: 'user',
      seq: 0,
      data: { text: 'subagent work', files: [] },
    })
    db.close()

    const source = createOpenCodeSessionSource({ dataDirs: [dataDir] })
    const descriptors = await source.discover({ sourceHostId: 'local' })
    expect(descriptors).toHaveLength(2)
    const main = descriptors.find(d => d.externalSessionId.endsWith('#oc-main'))!
    expect(main).toMatchObject({
      sourceApp: 'opencode',
      title: 'Investigate import',
      workspacePath: '/workspace/project',
      childSessionCount: 1,
    })
    expect(main.createdAt).toBe(1_800_000_000)

    const bundle = await source.capture({ descriptor: main })
    expect(bundle.manifest.files).toHaveLength(1)
    expect(bundle.manifest.files[0]?.bundlePath).toBe('source/000-main.opencode.db.gz')
    expect(bundle.manifest.files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)

    const result = await source.read({ descriptor: main, bundle })
    expect(result.messages.map(message => message.message.role)).toEqual(['user', 'assistant'])
    expect(result.messages[0]?.message.parts).toEqual([{ type: 'text', text: 'Add OpenCode import support' }])
    const assistantParts = result.messages[1]?.message.parts ?? []
    expect(assistantParts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reasoning', text: 'Thinking about sqlite snapshots' }),
      expect.objectContaining({
        type: 'tool-bash',
        toolCallId: 'part-tool-1',
        state: 'output-available',
        output: 'opencode.db',
      }),
      expect.objectContaining({ type: 'text', text: 'Import support added.' }),
    ]))
    expect(result.fidelity).toMatchObject({
      messages: 2,
      toolCalls: 1,
      reasoningParts: 1,
      omittedSystemEntries: 1,
      childSessions: 1,
    })

    // the filtered snapshot must not leak unrelated sessions
    const snapshotBytes = await readBytes(openExternalSessionBundleFile(bundle, bundle.manifest.files[0]!))
    expect(snapshotBytes.includes(Buffer.from('unrelated prompt that must not leak'))).toBe(false)
  })

  it('falls back to the first user prompt for untitled v2 sessions', async () => {
    const root = makeTempRoot('cradle-opencode-title-')
    const dataDir = join(root, 'opencode')
    mkdirSync(dataDir, { recursive: true })
    const db = createOpenCodeDb(join(dataDir, 'opencode.db'), { v2: true, migrated: true })
    insertV2Session(db, { id: 'oc-untitled', title: 'New session - 2027-01-15T07:00:00' })
    insertV2Message(db, {
      id: 'msg-u1',
      sessionId: 'oc-untitled',
      type: 'user',
      seq: 0,
      data: { text: 'Explain the migration semantics', files: [] },
    })
    db.close()

    const source = createOpenCodeSessionSource({ dataDirs: [dataDir] })
    const [descriptor] = await source.discover({ sourceHostId: 'local' })
    expect(descriptor?.title).toBe('Explain the migration semantics')
  })

  it('reads v1 rows for sessions not yet copied while migration is underway', async () => {
    const root = makeTempRoot('cradle-opencode-migration-')
    const dataDir = join(root, 'opencode')
    mkdirSync(dataDir, { recursive: true })
    const db = createOpenCodeDb(join(dataDir, 'opencode.db'), { v2: true, migrated: false })
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT, time_created INTEGER, time_updated INTEGER);
    `)
    insertV2Session(db, { id: 'oc-new', title: 'Copied session' })
    insertV1Session(db, { id: 'oc-old', title: 'Legacy session' })
    insertV1Session(db, { id: 'oc-copied-shadow', title: 'Shadow of copied session' })
    insertV2Session(db, { id: 'oc-copied-shadow', title: 'Copied session v2 row' })
    insertV1Message(db, {
      id: 'v1-u1',
      sessionId: 'oc-old',
      data: { id: 'v1-u1', role: 'user', time: { created: 1_800_000_001_000 } },
    })
    insertV1Part(db, {
      id: 'v1-p1',
      messageId: 'v1-u1',
      data: { type: 'text', text: 'legacy prompt text' },
    })
    insertV1Message(db, {
      id: 'v1-a1',
      sessionId: 'oc-old',
      data: { id: 'v1-a1', role: 'assistant', time: { created: 1_800_000_002_000, completed: 1_800_000_003_000 } },
    })
    insertV1Part(db, {
      id: 'v1-p2',
      messageId: 'v1-a1',
      data: { type: 'text', text: 'legacy reply' },
    })
    db.close()

    const source = createOpenCodeSessionSource({ dataDirs: [dataDir] })
    const descriptors = await source.discover({ sourceHostId: 'local' })
    const ids = descriptors.map(d => d.externalSessionId.split('#')[1]).sort()
    // oc-copied-shadow is read only from v2 once copied; oc-old not yet copied is read from v1
    expect(ids).toEqual(['oc-copied-shadow', 'oc-new', 'oc-old'])

    const legacy = descriptors.find(d => d.externalSessionId.endsWith('#oc-old'))!
    const bundle = await source.capture({ descriptor: legacy })
    const result = await source.read({ descriptor: legacy, bundle })
    expect(result.messages.map(message => message.message.role)).toEqual(['user', 'assistant'])
    expect(result.messages[0]?.message.parts).toEqual([{ type: 'text', text: 'legacy prompt text' }])
    expect(result.messages[1]?.message.parts).toEqual([{ type: 'text', text: 'legacy reply' }])
  })

  it('ignores v1 tables entirely once migration completed', async () => {
    const root = makeTempRoot('cradle-opencode-migrated-')
    const dataDir = join(root, 'opencode')
    mkdirSync(dataDir, { recursive: true })
    const db = createOpenCodeDb(join(dataDir, 'opencode.db'), { v2: true, migrated: true })
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created INTEGER, time_updated INTEGER);
    `)
    insertV2Session(db, { id: 'oc-new', title: 'New session' })
    insertV1Session(db, { id: 'oc-stale', title: 'Stale legacy row' })
    db.close()

    const source = createOpenCodeSessionSource({ dataDirs: [dataDir] })
    const descriptors = await source.discover({ sourceHostId: 'local' })
    expect(descriptors.map(d => d.externalSessionId.split('#')[1])).toEqual(['oc-new'])
  })

  it('rejects capture when the database changed after the scan', async () => {
    const root = makeTempRoot('cradle-opencode-drift-')
    const dataDir = join(root, 'opencode')
    mkdirSync(dataDir, { recursive: true })
    const dbPath = join(dataDir, 'opencode.db')
    const db = createOpenCodeDb(dbPath, { v2: true, migrated: true })
    insertV2Session(db, { id: 'oc-main', title: 'Drift' })
    db.close()

    const source = createOpenCodeSessionSource({ dataDirs: [dataDir] })
    const [descriptor] = await source.discover({ sourceHostId: 'local' })
    const writer = new Database(dbPath)
    insertV2Message(writer, {
      id: 'msg-late',
      sessionId: 'oc-main',
      type: 'user',
      seq: 0,
      data: { text: 'late write', files: [] },
    })
    writer.prepare(`UPDATE session_v2 SET time_updated = ? WHERE id = 'oc-main'`).run(1_800_000_999_000)
    writer.close()

    await expect(source.capture({ descriptor: descriptor! })).rejects.toThrow(/scan again before importing/)
  })

  it('discovers legacy storage JSON sessions, groups subagents, and projects from the bundle', async () => {
    const root = makeTempRoot('cradle-opencode-legacy-')
    const storage = join(root, 'opencode', 'storage')
    mkdirSync(join(storage, 'session', '-workspace-project'), { recursive: true })
    writeJson(join(storage, 'session', '-workspace-project', 'leg-main.json'), {
      id: 'leg-main',
      directory: '/workspace/project',
      title: '',
      time: { created: 1_800_000_000_000, updated: 1_800_000_100_000 },
    })
    writeJson(join(storage, 'session', '-workspace-project', 'leg-child.json'), {
      id: 'leg-child',
      parentID: 'leg-main',
      directory: '/workspace/project',
      title: 'Child session - x',
      time: { created: 1_800_000_050_000, updated: 1_800_000_060_000 },
    })
    mkdirSync(join(storage, 'message', 'leg-main'), { recursive: true })
    writeJson(join(storage, 'message', 'leg-main', 'lm-u1.json'), {
      id: 'lm-u1',
      role: 'user',
      time: { created: 1_800_000_001_000 },
    })
    writeJson(join(storage, 'message', 'leg-main', 'lm-a1.json'), {
      id: 'lm-a1',
      role: 'assistant',
      time: { created: 1_800_000_002_000, completed: 1_800_000_003_000 },
    })
    mkdirSync(join(storage, 'part', 'lm-u1'), { recursive: true })
    mkdirSync(join(storage, 'part', 'lm-a1'), { recursive: true })
    writeJson(join(storage, 'part', 'lm-u1', 'lp-1.json'), { type: 'text', text: 'Investigate the importer' })
    writeJson(join(storage, 'part', 'lm-u1', 'lp-2.json'), { type: 'text', text: 'injected template', synthetic: true })
    writeJson(join(storage, 'part', 'lm-a1', 'lp-3.json'), {
      type: 'tool',
      name: 'read',
      callID: 'call-9',
      state: { status: 'completed', input: { file_path: 'src/app.ts' }, output: 'file body' },
    })
    writeJson(join(storage, 'part', 'lm-a1', 'lp-4.json'), { type: 'text', text: 'Done.' })

    const source = createOpenCodeSessionSource({ dataDirs: [join(root, 'opencode')] })
    const descriptors = await source.discover({ sourceHostId: 'local' })
    expect(descriptors).toHaveLength(1)
    const main = descriptors[0]!
    expect(main).toMatchObject({
      externalSessionId: 'leg-main',
      title: 'Investigate the importer',
      childSessionCount: 1,
    })
    expect(main.sourceFiles.some(file => file.kind === 'subagent')).toBe(true)

    const bundle = await source.capture({ descriptor: main })
    expect(bundle.manifest.files.length).toBeGreaterThan(1)
    const result = await source.read({ descriptor: main, bundle })
    expect(result.messages.map(message => message.message.role)).toEqual(['user', 'assistant'])
    expect(result.messages[0]?.message.parts).toEqual([{ type: 'text', text: 'Investigate the importer' }])
    expect(result.messages[1]?.message.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-read',
        toolCallId: 'call-9',
        state: 'output-available',
        output: 'file body',
      }),
      expect.objectContaining({ type: 'text', text: 'Done.' }),
    ]))
    expect(result.fidelity).toMatchObject({
      messages: 2,
      toolCalls: 1,
      omittedSystemEntries: 1,
      childSessions: 1,
    })
  })

  it('projects tool errors and pairs content-array outputs', async () => {
    const root = makeTempRoot('cradle-opencode-toolerror-')
    const dataDir = join(root, 'opencode')
    mkdirSync(dataDir, { recursive: true })
    const db = createOpenCodeDb(join(dataDir, 'opencode.db'), { v2: true, migrated: true })
    insertV2Session(db, { id: 'oc-main', title: 'Tool outcomes' })
    insertV2Message(db, {
      id: 'msg-u1',
      sessionId: 'oc-main',
      type: 'user',
      seq: 0,
      data: { text: 'run the tool', files: [] },
    })
    insertV2Message(db, {
      id: 'msg-a1',
      sessionId: 'oc-main',
      type: 'assistant',
      seq: 1,
      data: {
        model: { id: 'm', providerID: 'p' },
        time: { created: 1_800_000_001_000, completed: 1_800_000_002_000 },
        content: [
          {
            type: 'tool',
            name: 'bash',
            id: 't-err',
            state: { status: 'error', input: {}, error: 'command failed' },
          },
          {
            type: 'tool',
            name: 'read',
            id: 't-content',
            state: {
              status: 'completed',
              input: {},
              content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }],
            },
          },
        ],
      },
    })
    db.close()

    const source = createOpenCodeSessionSource({ dataDirs: [dataDir] })
    const [descriptor] = await source.discover({ sourceHostId: 'local' })
    const bundle = await source.capture({ descriptor: descriptor! })
    const result = await source.read({ descriptor: descriptor!, bundle })
    const parts = result.messages[1]?.message.parts ?? []
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-bash', state: 'output-error', errorText: 'command failed' }),
      expect.objectContaining({ type: 'tool-read', state: 'output-available', output: 'line one\nline two' }),
    ]))
    expect(result.fidelity.toolCalls).toBe(2)
  })
})
