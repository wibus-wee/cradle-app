import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { openExternalSessionBundleFile } from '../bundle-store'
import { createClaudeSessionSource } from './claude'
import { createCodexSessionSource } from './codex'
import { createKimiSessionSource } from './kimi'

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

describe('external session source adapters', () => {
  it('groups Claude JSONL children, captures raw files, and parses only the Cradle-owned bundle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-claude-import-'))
    tempDirectories.push(root)
    process.env.CRADLE_DATA_DIR = join(root, 'data')
    const projects = join(root, 'projects')
    const project = join(projects, '-workspace-project')
    const sessionId = 'claude-main-1'
    const mainPath = join(project, `${sessionId}.jsonl`)
    const childPath = join(project, sessionId, 'subagents', 'agent-a.jsonl')
    mkdirSync(join(project, sessionId, 'subagents'), { recursive: true })
    writeJsonLines(mainPath, [
      claudeRow(sessionId, 'user-1', 'user', 'Investigate import behavior'),
      claudeRow(sessionId, 'assistant-tool', 'assistant', [
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'src/app.ts' } },
      ]),
      claudeRow(sessionId, 'tool-result', 'user', [
        { type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' },
      ]),
      claudeRow(sessionId, 'assistant-text', 'assistant', [
        { type: 'text', text: 'The importer needs a source catalog.' },
      ]),
    ])
    writeJsonLines(childPath, [
      { ...claudeRow(sessionId, 'child-user', 'user', 'Inspect the parser'), agentId: 'a' },
    ])
    const originalMainBytes = readFileSync(mainPath)
    const source = createClaudeSessionSource({ root: projects, concurrency: 2 })

    const [descriptor] = await source.discover({ sourceHostId: 'local' })
    expect(descriptor).toMatchObject({
      sourceApp: 'claude',
      externalSessionId: sessionId,
      workspacePath: '/workspace/project',
      childSessionCount: 1,
    })

    const bundle = await source.capture({ descriptor: descriptor! })
    expect(bundle.manifest.files).toHaveLength(2)
    const bundledMain = bundle.manifest.files.find(file => file.kind === 'main')!
    expect(await readBytes(openExternalSessionBundleFile(bundle, bundledMain))).toEqual(originalMainBytes)
    rmSync(projects, { recursive: true, force: true })
    const result = await source.read({ descriptor: descriptor!, bundle })
    expect(result.descriptor.childSessionCount).toBe(1)
    expect(result.messages.map(message => message.message.role)).toEqual([
      'user',
      'assistant',
    ])
    expect(result.messages[1]?.message.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-Read',
        toolCallId: 'tool-1',
        state: 'output-available',
        output: 'file contents',
      }),
      expect.objectContaining({
        type: 'text',
        text: 'The importer needs a source catalog.',
      }),
    ]))
    expect(result.fidelity).toMatchObject({
      messages: 2,
      toolCalls: 1,
      childSessions: 1,
    })
  })

  it('discovers current and archived Codex roots while excluding SubAgents from top-level candidates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-codex-import-'))
    tempDirectories.push(root)
    process.env.CRADLE_DATA_DIR = join(root, 'data')
    const current = join(root, 'sessions')
    const archived = join(root, 'archived_sessions')
    mkdirSync(join(current, '2027', '01', '15'), { recursive: true })
    mkdirSync(archived, { recursive: true })
    writeJsonLines(join(root, 'session_index.jsonl'), [
      { id: 'codex-main', thread_name: 'Named rollout' },
    ])
    writeJsonLines(join(root, 'history.jsonl'), [
      { session_id: 'codex-main', ts: 1_800_000_000, text: 'Build a better importer' },
    ])

    const mainPath = join(current, '2027', '01', '15', 'main.jsonl')
    writeJsonLines(mainPath, [
      sessionMeta({ id: 'codex-main', cwd: '/workspace/project', source: 'cli' }),
      responseItem('2027-01-15T07:00:01.000Z', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '# AGENTS.md instructions for fixture' }],
      }),
      codexUserEvent('2027-01-15T07:00:01.500Z', 'Build a better importer'),
      responseItem('2027-01-15T07:00:02.000Z', {
        type: 'function_call',
        name: 'command_execution',
        arguments: JSON.stringify({ command: 'pwd' }),
        call_id: 'call-1',
      }),
      responseItem('2027-01-15T07:00:03.000Z', {
        type: 'function_call_output',
        call_id: 'call-1',
        output: JSON.stringify({ output: '/workspace/project', exitCode: 0 }),
      }),
      responseItem('2027-01-15T07:00:04.000Z', {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Importer designed.' }],
      }),
    ])
    writeJsonLines(join(current, '2027', '01', '15', 'subagent.jsonl'), [
      sessionMeta({
        id: 'codex-child',
        cwd: '/workspace/project',
        source: 'subagent',
        parent_thread_id: 'codex-main',
      }),
    ])
    writeJsonLines(join(archived, 'archived.jsonl'), [
      sessionMeta({ id: 'codex-archived', cwd: '/workspace/old', source: 'cli' }),
      responseItem('2027-01-14T07:00:01.000Z', {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Archived work' }],
      }),
      codexUserEvent('2027-01-14T07:00:01.500Z', 'Archived work'),
    ])

    const source = createCodexSessionSource({ roots: { current, archived }, concurrency: 2 })
    const descriptors = await source.discover({ sourceHostId: 'local' })
    expect(descriptors).toHaveLength(2)
    expect(descriptors.map(descriptor => descriptor.externalSessionId)).toEqual([
      'codex-main',
      'codex-archived',
    ])
    expect(descriptors[0]).toMatchObject({
      archived: false,
      childSessionCount: 1,
      title: 'Named rollout',
      summary: 'Build a better importer',
    })
    expect(descriptors[1]).toMatchObject({ archived: true })

    const bundle = await source.capture({ descriptor: descriptors[0]! })
    const imported = await source.read({ descriptor: descriptors[0]!, bundle })
    expect(imported.messages.map(message => message.message.role)).toEqual([
      'user',
      'assistant',
    ])
    expect(imported.messages[0]?.message.parts).toEqual([
      { type: 'text', text: 'Build a better importer' },
    ])
    expect(imported.messages[1]?.message.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool-command_execution',
        toolCallId: 'call-1',
        state: 'output-available',
      }),
      expect.objectContaining({ type: 'text', text: 'Importer designed.' }),
    ]))
  })

  it('groups Kimi main and subagent wire files, reads state.json titles and times', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-kimi-import-'))
    tempDirectories.push(root)
    process.env.CRADLE_DATA_DIR = join(root, 'data')
    const home = join(root, 'kimi-home')
    const sessionId = 'session_aaaaaaaa-1111-2222-3333-444444444444'
    const sessionDir = join(home, 'sessions', '-workspace-project_000000000001', sessionId)
    mkdirSync(join(sessionDir, 'agents', 'main'), { recursive: true })
    mkdirSync(join(sessionDir, 'agents', 'agent-0'), { recursive: true })
    writeFileSync(join(sessionDir, 'state.json'), JSON.stringify({
      id: sessionId,
      version: 2,
      cwd: '/workspace/project',
      createdAt: 1786134177385,
      updatedAt: 1786134357754,
      archived: false,
      title: 'Review the diff',
      isCustomTitle: false,
      agents: { 'main': { type: 'main' }, 'agent-0': { type: 'sub' } },
    }))
    writeJsonLines(join(sessionDir, 'agents', 'main', 'wire.jsonl'), [
      { type: 'metadata', protocol_version: '1.5', created_at: 1786134177406 },
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'Port the parser' }],
        origin: { kind: 'user' },
        time: 1786134177442,
      },
      // Kimi Code's own timed context.append_message duplicates the prompt
      // and loop events and must be skipped (magpie transcript_kimi.go).
      {
        type: 'context.append_message',
        agentId: 'main',
        message: { role: 'user', content: [{ type: 'text', text: 'Port the parser' }], toolCalls: [] },
        time: 1786134177443,
      },
      {
        type: 'context.append_loop_event',
        event: { type: 'content.part', part: { type: 'think', think: 'thinking about parsers' } },
        time: 1786134178000,
      },
      {
        type: 'context.append_loop_event',
        event: {
          type: 'tool.call',
          toolCallId: 'tool-1',
          name: 'ReadFile',
          args: { path: 'src/parser.ts' },
        },
        time: 1786134179000,
      },
      {
        type: 'context.append_loop_event',
        event: { type: 'tool.result', toolCallId: 'tool-1', result: { output: 'parser contents' } },
        time: 1786134180000,
      },
      {
        type: 'context.append_loop_event',
        event: { type: 'content.part', part: { type: 'text', text: 'Parser ported.' } },
        time: 1786134181000,
      },
      { type: 'usage.record', agentId: 'main', model: 'kimi-code/k3', usage: { inputOther: 10, output: 5, inputCacheRead: 0, inputCacheCreation: 0 }, time: 1786134182000 },
    ])
    writeJsonLines(join(sessionDir, 'agents', 'agent-0', 'wire.jsonl'), [
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'Inspect subtask' }],
        origin: { kind: 'system_trigger', name: 'subagent' },
        time: 1786134183000,
      },
    ])
    const originalMainBytes = readFileSync(join(sessionDir, 'agents', 'main', 'wire.jsonl'))

    const source = createKimiSessionSource({ home, concurrency: 2 })
    const [descriptor] = await source.discover({ sourceHostId: 'local' })
    expect(descriptor).toMatchObject({
      sourceApp: 'kimi',
      externalSessionId: sessionId,
      workspacePath: '/workspace/project',
      title: 'Review the diff',
      summary: 'Port the parser',
      archived: false,
      createdAt: Math.floor(1786134177385 / 1000),
      updatedAt: Math.floor(1786134357754 / 1000),
      childSessionCount: 1,
    })
    expect(descriptor!.sourceFiles.map(file => `${file.kind}:${file.sourceId}`)).toEqual([
      'main:main',
      'subagent:agent-0',
      'main:state.json',
    ])

    const bundle = await source.capture({ descriptor: descriptor! })
    expect(bundle.manifest.files).toHaveLength(3)
    const bundledMain = bundle.manifest.files.find(file => file.sourceId === 'main')!
    expect(await readBytes(openExternalSessionBundleFile(bundle, bundledMain))).toEqual(originalMainBytes)
    rmSync(join(home, 'sessions'), { recursive: true, force: true })
    const result = await source.read({ descriptor: descriptor!, bundle })
    expect(result.messages.map(message => message.message.role)).toEqual(['user', 'assistant'])
    expect(result.messages[0]?.message.parts).toEqual([{ type: 'text', text: 'Port the parser' }])
    expect(result.messages[0]?.createdAt).toBe(Math.floor(1786134177442 / 1000))
    expect(result.messages[1]?.message.parts).toEqual(expect.arrayContaining([
      { type: 'reasoning', text: 'thinking about parsers' },
      expect.objectContaining({
        type: 'tool-ReadFile',
        toolCallId: 'tool-1',
        state: 'output-available',
        output: 'parser contents',
      }),
      { type: 'text', text: 'Parser ported.' },
    ]))
    expect(result.fidelity).toMatchObject({
      messages: 2,
      toolCalls: 1,
      reasoningParts: 1,
      childSessions: 1,
    })
  })

  it('titles Kimi sessions by user-given names and steered user input as user messages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-kimi-titles-'))
    tempDirectories.push(root)
    process.env.CRADLE_DATA_DIR = join(root, 'data')
    const home = join(root, 'kimi-home')
    const customId = 'session_bbbbbbbb-1111-2222-3333-444444444444'
    const customDir = join(home, 'sessions', 'slug_1', customId)
    mkdirSync(join(customDir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(customDir, 'state.json'), JSON.stringify({
      title: 'Named by the user',
      isCustomTitle: true,
      createdAt: '2026-07-22T02:24:36.705Z',
      updatedAt: '2026-07-22T02:27:00.637Z',
      workDir: '/workspace/old-protocol',
    }))
    writeJsonLines(join(customDir, 'agents', 'main', 'wire.jsonl'), [
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'actual first prompt' }],
        origin: { kind: 'user' },
      },
      {
        type: 'turn.steer',
        input: [{ type: 'text', text: 'steered mid-turn' }],
        origin: { kind: 'user' },
        time: 1786134200000,
      },
      // A skill activation is folded away, not a user message.
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'skill activation payload' }],
        origin: { kind: 'skill_activation' },
        time: 1786134210000,
      },
    ])

    const source = createKimiSessionSource({ home, concurrency: 2 })
    const [descriptor] = await source.discover({ sourceHostId: 'local' })
    // isCustomTitle wins over the first prompt; protocol 1.4 RFC 3339 times parse.
    expect(descriptor).toMatchObject({
      title: 'Named by the user',
      workspacePath: '/workspace/old-protocol',
      createdAt: Math.floor(Date.parse('2026-07-22T02:24:36.705Z') / 1000),
      updatedAt: Math.floor(Date.parse('2026-07-22T02:27:00.637Z') / 1000),
    })

    const bundle = await source.capture({ descriptor: descriptor! })
    const result = await source.read({ descriptor: descriptor!, bundle })
    expect(result.messages.map(message => [
      message.message.role,
      (message.message.parts[0] as { text: string }).text,
    ])).toEqual([
      ['user', 'actual first prompt'],
      ['user', 'steered mid-turn'],
    ])
    expect(result.fidelity.omittedSystemEntries).toBe(1)
  })

  it('falls back to session_index.jsonl for a Kimi session whose state.json names no folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-kimi-index-'))
    tempDirectories.push(root)
    process.env.CRADLE_DATA_DIR = join(root, 'data')
    const home = join(root, 'kimi-home')
    const sessionId = 'ses_cccccccc-1111-2222-3333-444444444444'
    const sessionDir = join(home, 'sessions', 'wd_v10-migrated_000000000006', sessionId)
    mkdirSync(join(sessionDir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(sessionDir, 'state.json'), JSON.stringify({
      createdAt: '2026-02-28T04:18:28.186Z',
      updatedAt: '2026-02-28T04:18:28.186Z',
      title: 'Old chat',
      isCustomTitle: true,
    }))
    writeJsonLines(join(sessionDir, 'agents', 'main', 'wire.jsonl'), [])
    writeJsonLines(join(home, 'session_index.jsonl'), [
      { sessionId, sessionDir, workDir: '/Users/me/Desktop/test' },
    ])

    const source = createKimiSessionSource({ home, concurrency: 2 })
    const [descriptor] = await source.discover({ sourceHostId: 'local' })
    expect(descriptor).toMatchObject({
      externalSessionId: sessionId,
      title: 'Old chat',
      workspacePath: '/Users/me/Desktop/test',
    })
  })

  it('projects migrated kimi-cli context.append_message records with tool call pairing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-kimi-migrated-'))
    tempDirectories.push(root)
    process.env.CRADLE_DATA_DIR = join(root, 'data')
    const home = join(root, 'kimi-home')
    const sessionId = 'ses_dddddddd-1111-2222-3333-444444444444'
    const sessionDir = join(home, 'sessions', 'wd_migrated_1', sessionId)
    mkdirSync(join(sessionDir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(sessionDir, 'state.json'), JSON.stringify({
      createdAt: '2026-02-28T04:18:28.186Z',
      title: 'Migrated',
      isCustomTitle: true,
    }))
    writeJsonLines(join(sessionDir, 'agents', 'main', 'wire.jsonl'), [
      { type: 'metadata', protocol_version: '1.4', created_at: 1772085117694 },
      {
        type: 'context.append_message',
        message: { role: 'user', content: [{ type: 'text', text: 'old ask' }], toolCalls: [] },
      },
      {
        type: 'context.append_message',
        message: {
          role: 'assistant',
          content: [{ type: 'think', think: 'old think' }, { type: 'text', text: 'old reply' }],
          toolCalls: [
            { type: 'function', id: 'tool_A', name: 'Shell', arguments: '{"command":"ls"}' },
            { type: 'function', id: 'tool_B', function: { name: 'ReadFile', arguments: '{"path":"a.go"}' } },
          ],
        },
      },
      {
        type: 'context.append_message',
        message: { role: 'tool', content: [{ type: 'text', text: 'a.go' }, { type: 'text', text: 'b.go' }], toolCalls: [], toolCallId: 'tool_A' },
      },
      {
        type: 'context.append_message',
        message: { role: 'tool', content: [{ type: 'text', text: 'package a' }], toolCalls: [], toolCallId: 'tool_B' },
      },
    ])

    const source = createKimiSessionSource({ home, concurrency: 2 })
    const [descriptor] = await source.discover({ sourceHostId: 'local' })
    expect(descriptor).toMatchObject({ externalSessionId: sessionId, title: 'Migrated' })

    const bundle = await source.capture({ descriptor: descriptor! })
    const result = await source.read({ descriptor: descriptor!, bundle })
    expect(result.messages.map(message => message.message.role)).toEqual(['user', 'assistant'])
    const parts = result.messages[1]?.message.parts ?? []
    expect(parts).toEqual(expect.arrayContaining([
      { type: 'reasoning', text: 'old think' },
      { type: 'text', text: 'old reply' },
      expect.objectContaining({
        type: 'tool-Shell',
        toolCallId: 'tool_A',
        input: { command: 'ls' },
        state: 'output-available',
        output: 'a.go\nb.go',
      }),
      expect.objectContaining({
        type: 'tool-ReadFile',
        toolCallId: 'tool_B',
        input: { path: 'a.go' },
        state: 'output-available',
        output: 'package a',
      }),
    ]))
    expect(result.fidelity).toMatchObject({ messages: 2, toolCalls: 2, reasoningParts: 1 })
  })

  it('reads a forked Kimi session from the copied history up to its forked marker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-kimi-fork-'))
    tempDirectories.push(root)
    process.env.CRADLE_DATA_DIR = join(root, 'data')
    const home = join(root, 'kimi-home')
    const sessionId = 'session_eeeeeeee-1111-2222-3333-444444444444'
    const sessionDir = join(home, 'sessions', 'slug_fork', sessionId)
    mkdirSync(join(sessionDir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(sessionDir, 'state.json'), JSON.stringify({
      createdAt: 1791700000000,
      cwd: '/workspace/forked',
      forkedFrom: 'session_source-0000-0000-0000-000000000000',
    }))
    writeJsonLines(join(sessionDir, 'agents', 'main', 'wire.jsonl'), [
      // Copied verbatim from the source session, times included.
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'source session ask' }],
        origin: { kind: 'user' },
        time: 1784436249636,
      },
      {
        type: 'context.append_loop_event',
        event: { type: 'content.part', part: { type: 'text', text: 'source session reply' } },
        time: 1784436255379,
      },
      { type: 'forked', agentId: 'main', time: 1791700000000 },
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'fork continuation' }],
        origin: { kind: 'user' },
        time: 1791700001000,
      },
    ])

    const source = createKimiSessionSource({ home, concurrency: 2 })
    const [descriptor] = await source.discover({ sourceHostId: 'local' })
    expect(descriptor).toMatchObject({
      externalSessionId: sessionId,
      workspacePath: '/workspace/forked',
    })

    const bundle = await source.capture({ descriptor: descriptor! })
    const result = await source.read({ descriptor: descriptor!, bundle })
    // The copied history is the conversation the fork goes on from, so it
    // is projected too (magpie transcript_kimi.go reads records before the
    // forked marker as the fork's context).
    expect(result.messages.map(message => [
      message.message.role,
      (message.message.parts[0] as { text: string }).text,
    ])).toEqual([
      ['user', 'source session ask'],
      ['assistant', 'source session reply'],
      ['user', 'fork continuation'],
    ])
  })

  it('lists archived Kimi sessions and dedupes sessions shared across roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cradle-kimi-dedupe-'))
    tempDirectories.push(root)
    process.env.CRADLE_DATA_DIR = join(root, 'data')
    const home = join(root, 'kimi-home')
    const sessionId = 'session_ffffffff-1111-2222-3333-444444444444'
    const sessionDir = join(home, 'sessions', 'slug_arch', sessionId)
    mkdirSync(join(sessionDir, 'agents', 'main'), { recursive: true })
    writeFileSync(join(sessionDir, 'state.json'), JSON.stringify({
      createdAt: 1791700000000,
      updatedAt: 1791700001000,
      cwd: '/workspace/archived',
      archived: true,
    }))
    writeJsonLines(join(sessionDir, 'agents', 'main', 'wire.jsonl'), [
      {
        type: 'turn.prompt',
        input: [{ type: 'text', text: 'archived work' }],
        origin: { kind: 'user' },
        time: 1791700000500,
      },
    ])

    const source = createKimiSessionSource({
      rootSets: [kimiRootSet(home), kimiRootSet(home)],
      concurrency: 2,
    })
    const descriptors = await source.discover({ sourceHostId: 'local' })
    expect(descriptors).toHaveLength(1)
    expect(descriptors[0]).toMatchObject({
      archived: true,
      title: 'archived work',
      workspacePath: '/workspace/archived',
    })
  })
})

function kimiRootSet(home: string) {
  return { home, sessions: join(home, 'sessions') }
}

function writeJsonLines(path: string, rows: unknown[]): void {
  writeFileSync(path, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8')
}

function sessionMeta(payload: Record<string, unknown>) {
  return {
    timestamp: '2027-01-15T07:00:00.000Z',
    type: 'session_meta',
    payload: {
      timestamp: '2027-01-15T07:00:00.000Z',
      originator: 'codex-cli',
      cli_version: '1.0.0',
      model_provider: 'openai',
      base_instructions: null,
      ...payload,
    },
  }
}

function responseItem(timestamp: string, payload: Record<string, unknown>) {
  return { timestamp, type: 'response_item', payload }
}

function codexUserEvent(timestamp: string, message: string) {
  return {
    timestamp,
    type: 'event_msg',
    payload: { type: 'user_message', message, images: [], local_images: [] },
  }
}

function claudeRow(
  sessionId: string,
  uuid: string,
  role: 'user' | 'assistant',
  content: string | Array<Record<string, unknown>>,
) {
  return {
    type: role,
    uuid,
    sessionId,
    cwd: '/workspace/project',
    gitBranch: 'main',
    timestamp: '2027-01-15T07:00:00.000Z',
    message: { role, content },
  }
}

async function readBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
