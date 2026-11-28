import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

import type { UIMessage } from 'ai'
import { z } from 'zod'

import {
  captureExternalSessionBundle,
  openExternalSessionBundleFile,
} from '../bundle-store'
import type { KimiImportRoot } from '../cradle-runtime-roots'
import { defaultKimiImportRoots, kimiImportRoot } from '../cradle-runtime-roots'
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
  unixSeconds,
} from '../source-utils'
import type {
  ExternalSessionDescriptor,
  ExternalSessionDiscoverInput,
  ExternalSessionFidelityReport,
  ExternalSessionImportMessage,
  ExternalSessionReadResult,
  ExternalSessionSourceAdapter,
  ExternalSessionSourceFile,
} from '../types'

// Kimi Code's state.json, read as normalizeSessionMeta reads it (magpie
// internal/sessions/kimi.go): epoch ms from protocol 1.5 on, RFC 3339
// strings before; cwd, or workDir before 1.5.
const KimiStateSchema = z.object({
  title: z.string().optional(),
  titleKind: z.string().optional(),
  isCustomTitle: z.boolean().optional(),
  customTitle: z.string().optional(),
  cwd: z.string().optional(),
  workDir: z.string().optional(),
  createdAt: z.union([z.number(), z.string()]).optional(),
  updatedAt: z.union([z.number(), z.string()]).optional(),
  forkedFrom: z.string().optional(),
  archived: z.boolean().optional(),
}).passthrough()

const KimiSessionIndexSchema = z.object({
  sessionId: z.string(),
  workDir: z.string(),
}).passthrough()

const KimiTextInputSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
}).passthrough()

const KimiLoopPartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  think: z.string().optional(),
}).passthrough()

const KimiLoopEventSchema = z.object({
  type: z.string(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
  args: z.unknown().optional(),
  part: KimiLoopPartSchema.optional(),
  result: z.object({
    output: z.unknown().optional(),
    isError: z.boolean().optional(),
  }).passthrough().optional(),
}).passthrough()

// context.append_message content from sessions migrated out of the Python
// kimi-cli: tool calls in Kimi's {id, name, arguments} shape or OpenAI's
// {id, function: {name, arguments}} (magpie transcript_kimi.go).
const KimiMessageSchema = z.object({
  role: z.string(),
  content: z.array(z.object({
    type: z.string(),
    text: z.string().optional(),
    think: z.string().optional(),
  }).passthrough()).optional(),
  toolCalls: z.array(z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    arguments: z.unknown().optional(),
    function: z.object({
      name: z.string().optional(),
      arguments: z.unknown().optional(),
    }).passthrough().optional(),
  }).passthrough()).optional(),
  toolCallId: z.string().optional(),
}).passthrough()

const KimiWireLineSchema = z.object({
  type: z.string(),
  time: z.number().optional(),
  input: z.array(KimiTextInputSchema).optional(),
  origin: z.object({
    kind: z.string().optional(),
    name: z.string().optional(),
  }).passthrough().optional(),
  event: KimiLoopEventSchema.optional(),
  message: KimiMessageSchema.optional(),
}).passthrough()

type KimiWireLine = z.infer<typeof KimiWireLineSchema>
type MutableToolPart = UIMessage['parts'][number] & {
  toolCallId?: string
  state?: string
  output?: unknown
  errorText?: string
}

// Wire record types Kimi Code writes for its own bookkeeping (usage,
// lifecycle, protocol negotiation). They carry no conversation content, so
// they are neither projected nor counted as unknown entries.
const KIMI_NON_CONTENT_TYPES = new Set([
  'metadata',
  'usage.record',
  'config.update',
  'permission.set_mode',
  'profile.bind',
  'mcp.tools_discovered',
  'llm.request',
  'llm.tools_snapshot',
  'interaction.request',
  'interaction.resolved',
  'turn.ended',
  'forked',
  'agent.message.appended',
])

const KIMI_LOOP_NON_CONTENT_EVENTS = new Set(['step.begin', 'step.end'])

export interface KimiSessionSourceOptions {
  rootSets?: KimiImportRoot[]
  root?: string
  home?: string
  concurrency?: number
}

function resolveKimiRootSets(options: KimiSessionSourceOptions): KimiImportRoot[] {
  if (options.rootSets) {
    return options.rootSets
  }
  if (options.home) {
    return [kimiImportRoot(options.home)]
  }
  if (options.root) {
    return [{ home: dirname(options.root), sessions: options.root }]
  }
  return defaultKimiImportRoots()
}

export function createKimiSessionSource(
  options: KimiSessionSourceOptions = {},
): ExternalSessionSourceAdapter {
  const rootSets = resolveKimiRootSets(options)
  return {
    sourceApp: 'kimi' as const,
    async discover(input) {
      const discoveries = await Promise.all(rootSets.map(rootSet =>
        discoverKimiSessions(rootSet, input, options.concurrency ?? 16)))
      return mergeExternalSessionDescriptors(discoveries.flat())
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
        .slice(0, input.limit ?? 2_000)
    },
    async capture(input) {
      return await captureExternalSessionBundle(input.descriptor)
    },
    async read(input) {
      return await readKimiSession(input.descriptor, input.bundle)
    },
  }
}

interface KimiSessionFiles {
  sessionId: string
  sessionDir: string
  mainWirePath: string | null
  wirePaths: string[]
}

async function discoverKimiSessions(
  rootSet: KimiImportRoot,
  input: ExternalSessionDiscoverInput,
  concurrency: number,
): Promise<ExternalSessionDescriptor[]> {
  const [wirePaths, indexedWorkDirs] = await Promise.all([
    listKimiWireFiles(rootSet.sessions),
    readKimiSessionIndexWorkDirs(rootSet.home),
  ])
  const sessions = new Map<string, KimiSessionFiles>()
  for (const wirePath of wirePaths) {
    const sessionDir = dirname(dirname(dirname(wirePath)))
    const sessionId = basename(sessionDir)
    const entry = sessions.get(sessionId) ?? {
      sessionId,
      sessionDir,
      mainWirePath: null,
      wirePaths: [],
    }
    entry.wirePaths.push(wirePath)
    // magpie kimiFilesIn: the session's own agent writes agents/main/wire.jsonl
    if (basename(dirname(wirePath)) === 'main') {
      entry.mainWirePath = wirePath
    }
    sessions.set(sessionId, entry)
  }
  return (await mapConcurrent([...sessions.values()], concurrency, async session =>
    await readKimiDescriptor(session, indexedWorkDirs, input.sourceHostId)))
    .filter((descriptor): descriptor is ExternalSessionDescriptor => descriptor !== null)
}

async function readKimiDescriptor(
  session: KimiSessionFiles,
  indexedWorkDirs: ReadonlyMap<string, string>,
  sourceHostId: string,
): Promise<ExternalSessionDescriptor | null> {
  if (!session.mainWirePath) {
    return null
  }
  const state = await readKimiState(join(session.sessionDir, 'state.json'))
  const sourceFiles = await readKimiSourceFiles(session)
  if (sourceFiles.length === 0) {
    return null
  }
  const firstUserText = await readKimiFirstUserPrompt(session.mainWirePath)

  // magpie kimiState.names(): a user-given name is title with isCustomTitle,
  // or titleKind "custom" when the flag is absent, or a bare customTitle.
  const customTitle = state?.title && state.isCustomTitle
    ? state.title
    : state?.title && !state?.isCustomTitle && state.titleKind === 'custom'
      ? state.title
      : state?.customTitle || null
  const generatedTitle = !customTitle && state?.title ? state.title : null
  const fallback = `Kimi session ${session.sessionId.replace(/^ses(?:sion)?_/, '').slice(0, 8)}`
  const titleText = customTitle ?? generatedTitle ?? firstUserText

  const workspacePath = state?.cwd ?? state?.workDir ?? indexedWorkDirs.get(session.sessionId) ?? ''
  const createdAt = unixSeconds(state?.createdAt ?? null)
  const stateUpdatedAt = unixSeconds(state?.updatedAt ?? null)
  const filesUpdatedAt = Math.floor(Math.max(...sourceFiles.map(file => file.modifiedAtMs)) / 1000)
  return {
    candidateId: createCandidateId({
      sourceHostId,
      sourceApp: 'kimi',
      externalSessionId: session.sessionId,
    }),
    sourceHostId,
    sourceApp: 'kimi',
    externalSessionId: session.sessionId,
    sourcePath: session.mainWirePath,
    sourceRevision: createSourceFilesRevision({
      externalSessionId: session.sessionId,
      files: sourceFiles,
    }),
    title: titleFromText(titleText ?? '', fallback),
    summary: firstUserText ? compactText(firstUserText, 180) : null,
    workspacePath,
    gitIdentity: emptyGitIdentity(),
    createdAt,
    updatedAt: stateUpdatedAt ?? filesUpdatedAt,
    archived: state?.archived ?? false,
    estimatedBytes: sourceFiles.reduce((total, file) => total + file.size, 0),
    childSessionCount: sourceFiles.filter(file => file.kind === 'subagent').length,
    sourceFiles,
  }
}

async function readKimiSourceFiles(session: KimiSessionFiles): Promise<ExternalSessionSourceFile[]> {
  const files: ExternalSessionSourceFile[] = []
  // The main wire file first, then subagents; capture order is the bundle order.
  const orderedWirePaths = session.wirePaths.sort((left, right) => {
    const leftMain = basename(dirname(left)) === 'main' ? 0 : 1
    const rightMain = basename(dirname(right)) === 'main' ? 0 : 1
    return leftMain - rightMain || left.localeCompare(right)
  })
  for (const wirePath of orderedWirePaths) {
    const wireStat = await stat(wirePath).catch(() => null)
    if (!wireStat?.isFile()) {
      continue
    }
    const agent = basename(dirname(wirePath))
    files.push({
      path: wirePath,
      kind: agent === 'main' ? 'main' : 'subagent',
      sourceId: agent,
      size: wireStat.size,
      modifiedAtMs: wireStat.mtimeMs,
    })
  }
  // state.json rides along as a main file: a title changed there reads the
  // session again (magpie kimiFilesIn folds it into the main file).
  const statePath = join(session.sessionDir, 'state.json')
  const stateStat = await stat(statePath).catch(() => null)
  if (stateStat?.isFile()) {
    files.push({
      path: statePath,
      kind: 'main',
      sourceId: 'state.json',
      size: stateStat.size,
      modifiedAtMs: stateStat.mtimeMs,
    })
  }
  return files
}

async function readKimiState(path: string): Promise<z.infer<typeof KimiStateSchema> | null> {
  try {
    const parsed = KimiStateSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
    return parsed.success ? parsed.data : null
  }
  catch {
    return null
  }
}

async function readKimiFirstUserPrompt(path: string): Promise<string> {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  let inspectedRows = 0
  try {
    for await (const line of lines) {
      inspectedRows += 1
      const record = parseKimiWireLine(line)
      if (record?.type === 'turn.prompt' && record.origin?.kind === 'user') {
        const text = kimiInputText(record)
        if (text) {
          return text
        }
      }
      if (inspectedRows >= 512) {
        break
      }
    }
  }
  finally {
    lines.close()
  }
  return ''
}

async function readKimiSession(
  descriptor: ExternalSessionDescriptor,
  bundle: Parameters<typeof openExternalSessionBundleFile>[0],
): Promise<ExternalSessionReadResult> {
  const mainFile = bundle.manifest.files.find(file => file.kind === 'main' && file.sourceId === 'main')
  if (!mainFile) {
    throw new Error(`Kimi session ${descriptor.externalSessionId} bundle has no main wire file`)
  }
  const fidelity: ExternalSessionFidelityReport = {
    messages: 0,
    toolCalls: 0,
    reasoningParts: 0,
    omittedSystemEntries: 0,
    unavailableAttachments: 0,
    childSessions: bundle.manifest.files.filter(file => file.kind === 'subagent').length,
    preservedUnknownEntries: 0,
  }
  const messages: ExternalSessionImportMessage[] = []
  let pendingAssistant: ExternalSessionImportMessage | null = null
  let lineNumber = 0
  const lines = createInterface({
    input: openExternalSessionBundleFile(bundle, mainFile),
    crlfDelay: Infinity,
  })

  const flushAssistant = () => {
    if (pendingAssistant?.message.parts.length) {
      messages.push(pendingAssistant)
    }
    pendingAssistant = null
  }

  const ensureAssistant = (sourceEntryId: string, createdAt: number | null) => {
    if (pendingAssistant) {
      appendKimiSourceEntryId(pendingAssistant, sourceEntryId)
      return pendingAssistant
    }
    pendingAssistant = importedMessage({
      id: kimiMessageId(descriptor, sourceEntryId),
      role: 'assistant',
      parts: [],
      sourceEntryIds: [sourceEntryId],
      createdAt,
      descriptor,
    })
    return pendingAssistant
  }

  const pendingParts = () => pendingAssistant?.message.parts ?? null

  for await (const line of lines) {
    lineNumber += 1
    const record = parseKimiWireLine(line)
    if (!record) {
      fidelity.preservedUnknownEntries += 1
      continue
    }
    const sourceEntryId = `line-${lineNumber}`
    const createdAt = typeof record.time === 'number' && record.time > 0
      ? Math.floor(record.time / 1000)
      : null

    if (record.type === 'turn.prompt' || record.type === 'turn.steer') {
      // A prompt typed (or steered mid-turn) by the user is a user message;
      // a skill's activation, a system_trigger, a background task's news is
      // folded away (magpie transcript_kimi.go reads them as context parts).
      const text = kimiInputText(record)
      if (record.origin?.kind !== 'user') {
        if (text) {
          fidelity.omittedSystemEntries += 1
        }
        continue
      }
      if (!text) {
        continue
      }
      flushAssistant()
      messages.push(importedMessage({
        id: kimiMessageId(descriptor, sourceEntryId),
        role: 'user',
        parts: [{ type: 'text', text }],
        sourceEntryIds: [sourceEntryId],
        createdAt,
        descriptor,
      }))
      continue
    }

    if (record.type === 'context.append_loop_event' && record.event) {
      const event = record.event
      if (event.type === 'content.part' && event.part) {
        const assistant = ensureAssistant(sourceEntryId, createdAt)
        if (event.part.type === 'text' && event.part.text) {
          assistant.message.parts.push({ type: 'text', text: event.part.text })
        }
        else if (event.part.type === 'think' && event.part.think) {
          assistant.message.parts.push({ type: 'reasoning', text: event.part.think })
          fidelity.reasoningParts += 1
        }
        else {
          fidelity.preservedUnknownEntries += 1
        }
        continue
      }
      if (event.type === 'tool.call' && event.toolCallId && event.name) {
        const assistant = ensureAssistant(sourceEntryId, createdAt)
        assistant.message.parts.push({
          type: `tool-${event.name}`,
          toolCallId: event.toolCallId,
          state: 'input-available',
          input: kimiToolArguments(event.args),
        } as UIMessage['parts'][number])
        fidelity.toolCalls += 1
        continue
      }
      if (event.type === 'tool.result' && event.toolCallId) {
        applyKimiToolResult(pendingAssistant, event.toolCallId, event.result?.output, event.result?.isError)
        continue
      }
      if (!KIMI_LOOP_NON_CONTENT_EVENTS.has(event.type)) {
        fidelity.preservedUnknownEntries += 1
      }
      continue
    }

    if (record.type === 'context.append_message') {
      // Kimi Code's own records carry a time and say again what the prompt
      // and loop events said; the untimed ones are content migrated from
      // the Python kimi-cli (magpie transcript_kimi.go).
      if (record.time) {
        continue
      }
      projectKimiMigratedMessage(record, {
        descriptor,
        fidelity,
        messages,
        sourceEntryId,
        createdAt,
        flushAssistant,
        ensureAssistant,
        pendingParts,
      })
      continue
    }

    if (!KIMI_NON_CONTENT_TYPES.has(record.type)) {
      fidelity.preservedUnknownEntries += 1
    }
  }
  flushAssistant()
  fidelity.messages = messages.length
  return { descriptor, contentHash: createContentHash(messages), messages, fidelity }
}

function projectKimiMigratedMessage(
  record: KimiWireLine,
  context: {
    descriptor: ExternalSessionDescriptor
    fidelity: ExternalSessionFidelityReport
    messages: ExternalSessionImportMessage[]
    sourceEntryId: string
    createdAt: number | null
    flushAssistant: () => void
    ensureAssistant: (sourceEntryId: string, createdAt: number | null) => ExternalSessionImportMessage
    pendingParts: () => UIMessage['parts'] | null
  },
): void {
  const message = record.message
  if (!message) {
    context.fidelity.preservedUnknownEntries += 1
    return
  }
  if (message.role === 'user') {
    const text = (message.content ?? [])
      .filter(part => part.type === 'text' && part.text)
      .map(part => part.text ?? '')
      .join('\n')
    if (!text) {
      return
    }
    context.flushAssistant()
    context.messages.push(importedMessage({
      id: kimiMessageId(context.descriptor, context.sourceEntryId),
      role: 'user',
      parts: [{ type: 'text', text }],
      sourceEntryIds: [context.sourceEntryId],
      createdAt: context.createdAt,
      descriptor: context.descriptor,
    }))
    return
  }
  if (message.role === 'assistant') {
    const assistant = context.ensureAssistant(context.sourceEntryId, context.createdAt)
    for (const part of message.content ?? []) {
      if (part.type === 'text' && part.text) {
        assistant.message.parts.push({ type: 'text', text: part.text })
      }
      else if (part.type === 'think' && part.think) {
        assistant.message.parts.push({ type: 'reasoning', text: part.think })
        context.fidelity.reasoningParts += 1
      }
    }
    for (const call of message.toolCalls ?? []) {
      const name = call.name ?? call.function?.name
      if (!call.id || !name) {
        context.fidelity.preservedUnknownEntries += 1
        continue
      }
      const args = call.arguments ?? call.function?.arguments
      assistant.message.parts.push({
        type: `tool-${name}`,
        toolCallId: call.id,
        state: 'input-available',
        input: kimiToolArguments(args),
      } as UIMessage['parts'][number])
      context.fidelity.toolCalls += 1
    }
    return
  }
  if (message.role === 'tool' && message.toolCallId) {
    const output = (message.content ?? [])
      .filter(part => part.type === 'text' && part.text)
      .map(part => part.text ?? '')
      .join('\n')
    // A migrated tool result pairs against the assistant turn in flight,
    // falling back to flushed assistant messages; without either it has
    // nowhere stable to land.
    const part = (context.pendingParts() ?? [])
      .find(candidate => (candidate as MutableToolPart).toolCallId === message.toolCallId) as MutableToolPart | undefined
      ?? lastAssistantToolPart(context.messages, message.toolCallId)
    if (!part) {
      context.fidelity.preservedUnknownEntries += 1
      return
    }
    part.state = 'output-available'
    part.output = output
    return
  }
  context.fidelity.preservedUnknownEntries += 1
}

function applyKimiToolResult(
  assistant: ExternalSessionImportMessage | null,
  toolCallId: string,
  output: unknown,
  isError: boolean | undefined,
): void {
  const part = (assistant?.message.parts ?? [])
    .find(candidate => (candidate as MutableToolPart).toolCallId === toolCallId) as MutableToolPart | undefined
  if (!part) {
    return
  }
  part.state = isError ? 'output-error' : 'output-available'
  if (isError) {
    part.errorText = typeof output === 'string' ? output : JSON.stringify(output ?? '')
  }
  else {
    part.output = typeof output === 'string' ? output : output ?? ''
  }
}

function lastAssistantToolPart(
  messages: ExternalSessionImportMessage[],
  toolCallId: string,
): MutableToolPart | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.message.role !== 'assistant') {
      continue
    }
    const part = message.message.parts.find(candidate =>
      (candidate as MutableToolPart).toolCallId === toolCallId) as MutableToolPart | undefined
    if (part) {
      return part
    }
  }
  return undefined
}

// A migrated call's arguments are an object, or OpenAI's string of JSON
// (magpie kimiArgs).
function kimiToolArguments(args: unknown): unknown {
  if (typeof args === 'string') {
    return safeJsonValue(args)
  }
  return args ?? {}
}

function kimiInputText(record: KimiWireLine): string {
  return (record.input ?? [])
    .filter(part => part.type === 'text' && part.text)
    .map(part => part.text ?? '')
    .join('\n')
}

function appendKimiSourceEntryId(message: ExternalSessionImportMessage, sourceEntryId: string): void {
  if (!message.sourceEntryIds.includes(sourceEntryId)) {
    message.sourceEntryIds.push(sourceEntryId)
  }
  const metadata = message.message.metadata as { externalImport: { sourceEntryIds: string[] } }
  metadata.externalImport.sourceEntryIds = [...message.sourceEntryIds]
}

function parseKimiWireLine(line: string): KimiWireLine | null {
  if (!line.trim()) {
    return null
  }
  try {
    const parsed = KimiWireLineSchema.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data : null
  }
  catch {
    return null
  }
}

// Wire files of every session under a Kimi Code home's sessions folder:
// sessions/<workdir slug>/<session id>/agents/<agent>/wire.jsonl (magpie
// kimiFilesIn). Only that exact depth is a session wire file.
async function listKimiWireFiles(sessionsRoot: string): Promise<string[]> {
  const files: string[] = []
  const slugs = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => [])
  for (const slug of slugs) {
    if (!slug.isDirectory()) {
      continue
    }
    const slugDir = join(sessionsRoot, slug.name)
    const sessionDirs = await readdir(slugDir, { withFileTypes: true }).catch(() => [])
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) {
        continue
      }
      const agentsDir = join(slugDir, sessionDir.name, 'agents')
      const agents = await readdir(agentsDir, { withFileTypes: true }).catch(() => [])
      for (const agent of agents) {
        if (!agent.isDirectory()) {
          continue
        }
        const wirePath = join(agentsDir, agent.name, 'wire.jsonl')
        const wireStat = await stat(wirePath).catch(() => null)
        if (wireStat?.isFile()) {
          files.push(wirePath)
        }
      }
    }
  }
  return files
}

// session_index.jsonl at the root of Kimi's home supplies the folder of a
// session whose state.json names none (#2103 in magpie).
async function readKimiSessionIndexWorkDirs(home: string): Promise<Map<string, string>> {
  const workDirs = new Map<string, string>()
  const path = join(home, 'session_index.jsonl')
  const fileStat = await stat(path).catch(() => null)
  if (!fileStat?.isFile()) {
    return workDirs
  }
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of lines) {
    try {
      const parsed = KimiSessionIndexSchema.safeParse(JSON.parse(line))
      if (parsed.success && parsed.data.sessionId && parsed.data.workDir) {
        workDirs.set(parsed.data.sessionId, parsed.data.workDir)
      }
    }
    catch {
      // A malformed index row does not invalidate the underlying session.
    }
  }
  return workDirs
}

async function mapConcurrent<TInput, TOutput>(
  inputs: TInput[],
  concurrency: number,
  mapper: (input: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = Array.from<TOutput>({ length: inputs.length })
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(inputs[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

function kimiMessageId(
  descriptor: ExternalSessionDescriptor,
  sourceEntryId: string,
): string {
  return createImportedMessageId({
    sourceApp: descriptor.sourceApp,
    externalSessionId: descriptor.externalSessionId,
    sourceEntryId,
  })
}
