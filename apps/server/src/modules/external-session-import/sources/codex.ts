import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

import type { UIMessage } from 'ai'
import { z } from 'zod'

import {
  captureExternalSessionBundle,
  openExternalSessionBundleFile,
} from '../bundle-store'
import type { CodexImportRootSet } from '../cradle-runtime-roots'
import { defaultCodexImportRootSets } from '../cradle-runtime-roots'
import {
  compactText,
  createCandidateId,
  createContentHash,
  createImportedMessageId,
  createSourceFilesRevision,
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

const CodexGitSchema = z.object({
  commit_hash: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  repository_url: z.string().nullable().optional(),
}).passthrough()

const CodexSessionMetaSchema = z.object({
  id: z.string(),
  timestamp: z.union([z.string(), z.number()]).nullable().optional(),
  cwd: z.string().min(1),
  source: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  git: CodexGitSchema.nullable().optional(),
  parent_thread_id: z.string().nullable().optional(),
  forked_from_id: z.string().nullable().optional(),
  session_id: z.string().nullable().optional(),
}).passthrough()

const CodexEnvelopeSchema = z.object({
  type: z.string(),
  timestamp: z.union([z.string(), z.number()]).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

const CodexSessionIndexSchema = z.object({
  id: z.string(),
  thread_name: z.string(),
}).passthrough()

const CodexHistorySchema = z.object({
  session_id: z.string(),
  text: z.string(),
}).passthrough()

const CodexUserEventSchema = z.object({
  type: z.literal('user_message'),
  message: z.string(),
  images: z.array(z.unknown()).optional(),
  local_images: z.array(z.unknown()).optional(),
}).passthrough()

const CodexMessageItemSchema = z.object({
  type: z.literal('message'),
  role: z.string(),
  content: z.array(z.object({
    type: z.string(),
    text: z.string().optional(),
    image_url: z.string().optional(),
  }).passthrough()),
}).passthrough()

const CodexReasoningItemSchema = z.object({
  type: z.literal('reasoning'),
  summary: z.array(z.union([
    z.string(),
    z.object({ text: z.string() }).passthrough(),
  ])).optional(),
  content: z.array(z.union([
    z.string(),
    z.object({ text: z.string() }).passthrough(),
  ])).optional(),
}).passthrough()

const CodexFunctionCallSchema = z.object({
  type: z.enum(['function_call', 'custom_tool_call']),
  call_id: z.string(),
  name: z.string(),
  arguments: z.string().optional(),
  input: z.unknown().optional(),
}).passthrough()

const CodexFunctionOutputSchema = z.object({
  type: z.enum(['function_call_output', 'custom_tool_call_output']),
  call_id: z.string(),
  output: z.unknown(),
}).passthrough()

type MutableToolPart = UIMessage['parts'][number] & {
  toolCallId?: string
  state?: string
  output?: unknown
}

interface CodexRolloutRoots {
  current: string
  archived: string
}

interface CodexRolloutMetadata {
  descriptor: ExternalSessionDescriptor
  sourceKind: string
  parentThreadId: string | null
  treeSessionId: string | null
}

export interface CodexSessionSourceOptions {
  rootSets?: CodexImportRootSet[]
  roots?: CodexRolloutRoots
  sessionIndex?: string
  history?: string
  concurrency?: number
}

function resolveCodexRootSets(options: CodexSessionSourceOptions): CodexImportRootSet[] {
  if (options.rootSets) {
    return options.rootSets
  }
  if (options.roots) {
    const sessionIndex = options.sessionIndex ?? join(dirname(options.roots.current), 'session_index.jsonl')
    const history = options.history ?? join(dirname(options.roots.current), 'history.jsonl')
    return [{ roots: options.roots, sessionIndex, history }]
  }
  return defaultCodexImportRootSets()
}

export function createCodexSessionSource(
  options: CodexSessionSourceOptions = {},
): ExternalSessionSourceAdapter {
  const rootSets = resolveCodexRootSets(options)
  return {
    sourceApp: 'codex',
    async discover(input) {
      const discoveries = await Promise.all(rootSets.map(rootSet =>
        discoverCodexSessions(
          rootSet.roots,
          rootSet.sessionIndex,
          rootSet.history,
          input,
          options.concurrency ?? 24,
        )))
      return mergeExternalSessionDescriptors(discoveries.flat())
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
        .slice(0, input.limit ?? 2_000)
    },
    async capture(input) {
      return await captureExternalSessionBundle(input.descriptor)
    },
    async read(input) {
      return await readCodexSession(input.descriptor, input.bundle)
    },
  }
}

async function discoverCodexSessions(
  roots: CodexRolloutRoots,
  sessionIndex: string,
  history: string,
  input: ExternalSessionDiscoverInput,
  concurrency: number,
): Promise<ExternalSessionDescriptor[]> {
  const [currentPaths, archivedPaths, indexedTitles, historyPrompts] = await Promise.all([
    listJsonlFiles(roots.current),
    listJsonlFiles(roots.archived),
    readCodexSessionTitles(sessionIndex),
    readCodexHistoryPrompts(history),
  ])
  const paths = [
    ...currentPaths.map(path => ({ path, archived: false })),
    ...archivedPaths.map(path => ({ path, archived: true })),
  ]
  const metadata = (await mapConcurrent(paths, concurrency, async file =>
    await readCodexRolloutMetadata(
      file.path,
      file.archived,
      input.sourceHostId,
      historyPrompts,
    )))
    .filter((entry): entry is CodexRolloutMetadata => entry !== null)

  const childCounts = new Map<string, number>()
  const childFiles = new Map<string, ExternalSessionSourceFile[]>()
  for (const entry of metadata) {
    if (entry.sourceKind !== 'subagent') {
      continue
    }
    const parentKey = entry.parentThreadId ?? entry.treeSessionId
    if (parentKey) {
      childCounts.set(parentKey, (childCounts.get(parentKey) ?? 0) + 1)
      const files = childFiles.get(parentKey) ?? []
      files.push(...entry.descriptor.sourceFiles.map(file => ({ ...file, kind: 'subagent' as const })))
      childFiles.set(parentKey, files)
    }
  }

  return metadata
    .filter(entry => entry.sourceKind !== 'subagent')
    .map((entry) => {
      const key = childFiles.has(entry.descriptor.externalSessionId)
        ? entry.descriptor.externalSessionId
        : entry.treeSessionId ?? ''
      const sourceFiles = [
        ...entry.descriptor.sourceFiles,
        ...(childFiles.get(key) ?? []),
      ]
      return {
        ...entry.descriptor,
        title: indexedTitles.get(entry.descriptor.externalSessionId) ?? entry.descriptor.title,
        sourceRevision: createSourceFilesRevision({
          externalSessionId: entry.descriptor.externalSessionId,
          files: sourceFiles,
        }),
        estimatedBytes: sourceFiles.reduce((total, file) => total + file.size, 0),
        childSessionCount: childCounts.get(entry.descriptor.externalSessionId)
          ?? childCounts.get(entry.treeSessionId ?? '')
          ?? 0,
        sourceFiles,
      }
    })
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
}

async function readCodexRolloutMetadata(
  path: string,
  archived: boolean,
  sourceHostId: string,
  historyPrompts: ReadonlyMap<string, string>,
): Promise<CodexRolloutMetadata | null> {
  const fileStat = await stat(path).catch(() => null)
  if (!fileStat?.isFile()) {
    return null
  }
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  let meta: z.infer<typeof CodexSessionMetaSchema> | null = null
  let firstUserText = ''
  try {
    for await (const line of lines) {
      const envelope = parseCodexEnvelope(line)
      if (!envelope) {
        continue
      }
      if (envelope.type === 'session_meta' && envelope.payload) {
        const parsedMeta = CodexSessionMetaSchema.safeParse(envelope.payload)
        if (parsedMeta.success) {
          meta = parsedMeta.data
          if (readCodexSourceKind(meta.source) === 'subagent') {
            break
          }
          firstUserText = historyPrompts.get(meta.id) ?? ''
          if (firstUserText) {
            break
          }
        }
        continue
      }
      if (envelope.type !== 'event_msg' || !envelope.payload) {
        continue
      }
      const event = CodexUserEventSchema.safeParse(envelope.payload)
      if (!event.success) {
        continue
      }
      firstUserText = event.data.message
      if (firstUserText) {
        break
      }
    }
  }
  finally {
    lines.close()
  }
  if (!meta) {
    return null
  }
  const sourceKind = readCodexSourceKind(meta.source)
  const updatedAt = Math.floor(fileStat.mtimeMs / 1000)
  const git = meta.git
  const descriptor: ExternalSessionDescriptor = {
    candidateId: createCandidateId({
      sourceHostId,
      sourceApp: 'codex',
      externalSessionId: meta.id,
    }),
    sourceHostId,
    sourceApp: 'codex',
    externalSessionId: meta.id,
    sourcePath: path,
    sourceRevision: '',
    title: titleFromText(firstUserText, `Codex session ${meta.id.slice(0, 8)}`),
    summary: firstUserText ? compactText(firstUserText, 180) : null,
    workspacePath: meta.cwd,
    gitIdentity: {
      originUrl: git?.repository_url ?? null,
      repoRoot: null,
      branch: git?.branch ?? null,
      headSha: git?.commit_hash ?? null,
    },
    createdAt: unixSeconds(meta.timestamp ?? null),
    updatedAt,
    archived,
    estimatedBytes: fileStat.size,
    childSessionCount: null,
    sourceFiles: [{
      path,
      kind: sourceKind === 'subagent' ? 'subagent' : 'main',
      sourceId: meta.id,
      size: fileStat.size,
      modifiedAtMs: fileStat.mtimeMs,
    }],
  }
  descriptor.sourceRevision = createSourceFilesRevision({
    externalSessionId: meta.id,
    files: descriptor.sourceFiles,
  })
  return {
    descriptor,
    sourceKind,
    parentThreadId: meta.parent_thread_id ?? null,
    treeSessionId: meta.session_id ?? null,
  }
}

async function readCodexSession(
  descriptor: ExternalSessionDescriptor,
  bundle: Parameters<typeof openExternalSessionBundleFile>[0],
): Promise<ExternalSessionReadResult> {
  const mainFile = bundle.manifest.files.find(file => file.kind === 'main')
  if (!mainFile) {
    throw new Error(`Codex session ${descriptor.externalSessionId} bundle has no main rollout`)
  }

  const fidelity: ExternalSessionFidelityReport = {
    messages: 0,
    toolCalls: 0,
    reasoningParts: 0,
    omittedSystemEntries: 0,
    unavailableAttachments: 0,
    childSessions: descriptor.childSessionCount ?? 0,
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
    if (!pendingAssistant || pendingAssistant.message.parts.length === 0) {
      pendingAssistant = null
      return
    }
    messages.push(pendingAssistant)
    pendingAssistant = null
  }

  for await (const line of lines) {
    lineNumber += 1
    const envelope = parseCodexEnvelope(line)
    if (!envelope) {
      fidelity.preservedUnknownEntries += 1
      continue
    }
    const sourceEntryId = `line-${lineNumber}`
    const createdAt = unixSeconds(envelope.timestamp ?? null)
    if (envelope.type === 'event_msg' && envelope.payload) {
      const userEvent = CodexUserEventSchema.safeParse(envelope.payload)
      if (userEvent.success) {
        flushAssistant()
        messages.push(importedMessage({
          id: importedMessageId(descriptor, sourceEntryId),
          role: 'user',
          parts: [{ type: 'text', text: userEvent.data.message }],
          sourceEntryIds: [sourceEntryId],
          createdAt,
          descriptor,
        }))
        fidelity.unavailableAttachments += (userEvent.data.images?.length ?? 0)
          + (userEvent.data.local_images?.length ?? 0)
      }
      else if (envelope.payload.type !== 'task_started'
        && envelope.payload.type !== 'task_complete'
        && envelope.payload.type !== 'token_count') {
        fidelity.preservedUnknownEntries += 1
      }
      continue
    }
    if (envelope.type !== 'response_item' || !envelope.payload) {
      if (!['session_meta', 'turn_context'].includes(envelope.type)) {
        fidelity.preservedUnknownEntries += 1
      }
      continue
    }
    const messageItem = CodexMessageItemSchema.safeParse(envelope.payload)
    if (messageItem.success) {
      if (messageItem.data.role === 'developer' || messageItem.data.role === 'system') {
        fidelity.omittedSystemEntries += 1
        continue
      }
      if (messageItem.data.role === 'user') {
        fidelity.preservedUnknownEntries += 1
        continue
      }
      if (messageItem.data.role === 'assistant') {
        pendingAssistant = ensurePendingAssistant(
          pendingAssistant,
          descriptor,
          sourceEntryId,
          createdAt,
        )
        for (const content of messageItem.data.content) {
          if (content.type === 'output_text' && content.text) {
            pendingAssistant.message.parts.push({ type: 'text', text: content.text })
          }
        }
        continue
      }
    }

    const reasoningItem = CodexReasoningItemSchema.safeParse(envelope.payload)
    if (reasoningItem.success) {
      const reasoningText = readCodexReasoning(reasoningItem.data)
      if (reasoningText) {
        pendingAssistant = ensurePendingAssistant(
          pendingAssistant,
          descriptor,
          sourceEntryId,
          createdAt,
        )
        pendingAssistant.message.parts.push({ type: 'reasoning', text: reasoningText })
        fidelity.reasoningParts += 1
      }
      continue
    }

    const callItem = CodexFunctionCallSchema.safeParse(envelope.payload)
    if (callItem.success) {
      pendingAssistant = ensurePendingAssistant(
        pendingAssistant,
        descriptor,
        sourceEntryId,
        createdAt,
      )
      pendingAssistant.message.parts.push({
        type: `tool-${callItem.data.name}`,
        toolCallId: callItem.data.call_id,
        state: 'input-available',
        input: callItem.data.arguments
          ? safeJsonValue(callItem.data.arguments)
          : callItem.data.input ?? {},
      } as UIMessage['parts'][number])
      fidelity.toolCalls += 1
      continue
    }

    const outputItem = CodexFunctionOutputSchema.safeParse(envelope.payload)
    if (outputItem.success) {
      applyCodexToolOutput(pendingAssistant, outputItem.data.call_id, outputItem.data.output)
      continue
    }
    fidelity.preservedUnknownEntries += 1
  }
  flushAssistant()
  fidelity.messages = messages.length
  return {
    descriptor,
    contentHash: createContentHash(messages),
    messages,
    fidelity,
  }
}

function ensurePendingAssistant(
  current: ExternalSessionImportMessage | null,
  descriptor: ExternalSessionDescriptor,
  sourceEntryId: string,
  createdAt: number | null,
): ExternalSessionImportMessage {
  if (current) {
    current.sourceEntryIds.push(sourceEntryId)
    const metadata = current.message.metadata as {
      externalImport: { sourceEntryIds: string[] }
    }
    metadata.externalImport.sourceEntryIds = [...current.sourceEntryIds]
    return current
  }
  return importedMessage({
    id: importedMessageId(descriptor, sourceEntryId),
    role: 'assistant',
    parts: [],
    sourceEntryIds: [sourceEntryId],
    createdAt,
    descriptor,
  })
}

function applyCodexToolOutput(
  assistant: ExternalSessionImportMessage | null,
  toolCallId: string,
  output: unknown,
): void {
  if (!assistant) {
    return
  }
  const part = assistant.message.parts.find((candidate) => {
    const toolPart = candidate as MutableToolPart
    return toolPart.toolCallId === toolCallId
  }) as MutableToolPart | undefined
  if (!part) {
    return
  }
  part.state = 'output-available'
  part.output = typeof output === 'string' ? safeJsonValue(output) : output
}

function readCodexReasoning(
  item: z.infer<typeof CodexReasoningItemSchema>,
): string {
  const values = item.summary?.length ? item.summary : item.content ?? []
  return values
    .map(value => typeof value === 'string' ? value : value.text)
    .filter(Boolean)
    .join('\n')
}

function readCodexSourceKind(source: z.infer<typeof CodexSessionMetaSchema>['source']): string {
  if (typeof source === 'string') {
    return source
  }
  if (!source) {
    return 'unknown'
  }
  const keys = Object.keys(source)
  return keys[0] ?? 'unknown'
}

function parseCodexEnvelope(line: string): z.infer<typeof CodexEnvelopeSchema> | null {
  if (!line.trim()) {
    return null
  }
  try {
    const parsed = CodexEnvelopeSchema.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data : null
  }
  catch {
    return null
  }
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      }
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path)
      }
    }))
  }
  await visit(root)
  return files
}

async function readCodexSessionTitles(path: string): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  const fileStat = await stat(path).catch(() => null)
  if (!fileStat?.isFile()) {
    return titles
  }
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of lines) {
    try {
      const parsed = CodexSessionIndexSchema.safeParse(JSON.parse(line))
      if (parsed.success && parsed.data.thread_name.trim()) {
        titles.set(parsed.data.id, compactText(parsed.data.thread_name, 80))
      }
    }
    catch {
      // A malformed index row does not invalidate the underlying rollout.
    }
  }
  return titles
}

async function readCodexHistoryPrompts(path: string): Promise<Map<string, string>> {
  const prompts = new Map<string, string>()
  const fileStat = await stat(path).catch(() => null)
  if (!fileStat?.isFile()) {
    return prompts
  }
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of lines) {
    try {
      const parsed = CodexHistorySchema.safeParse(JSON.parse(line))
      if (parsed.success && parsed.data.text.trim() && !prompts.has(parsed.data.session_id)) {
        prompts.set(parsed.data.session_id, parsed.data.text)
      }
    }
    catch {
      // A malformed history row does not invalidate the underlying rollout.
    }
  }
  return prompts
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

function importedMessageId(
  descriptor: ExternalSessionDescriptor,
  sourceEntryId: string,
): string {
  return createImportedMessageId({
    sourceApp: descriptor.sourceApp,
    externalSessionId: descriptor.externalSessionId,
    sourceEntryId,
  })
}

export function codexRolloutName(path: string): string {
  return basename(path, '.jsonl')
}
