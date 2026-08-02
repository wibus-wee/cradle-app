import type { Stats } from 'node:fs'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { createInterface } from 'node:readline'

import type { UIMessage } from 'ai'
import { z } from 'zod'

import {
  captureExternalSessionBundle,
  openExternalSessionBundleFile,
} from '../bundle-store'
import { defaultClaudeImportRoots } from '../cradle-runtime-roots'
import {
  compactText,
  createCandidateId,
  createContentHash,
  createImportedMessageId,
  createSourceFilesRevision,
  emptyGitIdentity,
  importedMessage,
  mergeExternalSessionDescriptors,
  titleFromText,
  unixSeconds,
} from '../source-utils'
import type {
  ExternalSessionBundleFile,
  ExternalSessionDescriptor,
  ExternalSessionDiscoverInput,
  ExternalSessionFidelityReport,
  ExternalSessionImportMessage,
  ExternalSessionReadResult,
  ExternalSessionSourceAdapter,
  ExternalSessionSourceFile,
} from '../types'

const ClaudeContentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  thinking: z.string().optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  content: z.unknown().optional(),
  is_error: z.boolean().optional(),
}).passthrough()

const ClaudeMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(ClaudeContentBlockSchema)]),
}).passthrough()

const ClaudeEnvelopeSchema = z.object({
  type: z.string(),
  uuid: z.string().optional(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  cwd: z.string().optional(),
  gitBranch: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  message: ClaudeMessageSchema.optional(),
}).passthrough()

type ClaudeContentBlock = z.infer<typeof ClaudeContentBlockSchema>
type ClaudeEnvelope = z.infer<typeof ClaudeEnvelopeSchema>
type MutableToolPart = UIMessage['parts'][number] & {
  toolCallId?: string
  state?: string
  output?: unknown
  errorText?: string
}

export interface ClaudeSessionSourceOptions {
  roots?: string[]
  root?: string
  concurrency?: number
}

function resolveClaudeRoots(options: ClaudeSessionSourceOptions): string[] {
  if (options.roots) {
    return options.roots
  }
  if (options.root) {
    return [options.root]
  }
  return defaultClaudeImportRoots()
}

export function createClaudeSessionSource(
  options: ClaudeSessionSourceOptions = {},
): ExternalSessionSourceAdapter {
  const roots = resolveClaudeRoots(options)
  return {
    sourceApp: 'claude',
    async discover(input) {
      const discoveries = await Promise.all(roots.map(root =>
        discoverClaudeSessions(root, input, options.concurrency ?? 16)))
      return mergeExternalSessionDescriptors(discoveries.flat())
        .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
        .slice(0, input.limit ?? 2_000)
    },
    async capture(input) {
      return await captureExternalSessionBundle(input.descriptor)
    },
    async read(input) {
      return await readClaudeSession(input.descriptor, input.bundle.manifest.files, input.bundle)
    },
  }
}

async function discoverClaudeSessions(
  root: string,
  input: ExternalSessionDiscoverInput,
  concurrency: number,
): Promise<ExternalSessionDescriptor[]> {
  const paths = (await listJsonlFiles(root))
    .filter(path => !path.includes(`${sep}subagents${sep}`))
  const descriptors = (await mapConcurrent(paths, concurrency, async path =>
    await readClaudeDescriptor(path, input.sourceHostId)))
    .filter((descriptor): descriptor is ExternalSessionDescriptor => descriptor !== null)
  return descriptors
}

async function readClaudeDescriptor(
  path: string,
  sourceHostId: string,
): Promise<ExternalSessionDescriptor | null> {
  const mainStat = await stat(path).catch(() => null)
  if (!mainStat?.isFile()) {
    return null
  }
  const fallbackSessionId = basename(path, '.jsonl')
  let externalSessionId = fallbackSessionId
  let workspacePath = ''
  let gitBranch: string | null = null
  let firstUserText = ''
  let createdAt: number | null = null
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  let inspectedRows = 0
  try {
    for await (const line of lines) {
      inspectedRows += 1
      const envelope = parseClaudeEnvelope(line)
      if (!envelope) {
        continue
      }
      externalSessionId = envelope.sessionId ?? externalSessionId
      workspacePath ||= envelope.cwd ?? ''
      gitBranch ??= envelope.gitBranch ?? null
      createdAt ??= unixSeconds(envelope.timestamp)
      if (envelope.message?.role === 'user') {
        firstUserText ||= readClaudeUserText(envelope.message.content)
      }
      if (workspacePath && firstUserText && inspectedRows >= 8) {
        break
      }
      if (inspectedRows >= 512) {
        break
      }
    }
  }
  finally {
    lines.close()
  }
  if (!workspacePath || externalSessionId !== fallbackSessionId) {
    return null
  }

  const sourceFiles = await readClaudeSourceFiles(path, externalSessionId, mainStat)
  const updatedAt = Math.floor(Math.max(...sourceFiles.map(file => file.modifiedAtMs)) / 1000)
  const estimatedBytes = sourceFiles.reduce((total, file) => total + file.size, 0)
  return {
    candidateId: createCandidateId({ sourceHostId, sourceApp: 'claude', externalSessionId }),
    sourceHostId,
    sourceApp: 'claude',
    externalSessionId,
    sourcePath: path,
    sourceRevision: createSourceFilesRevision({ externalSessionId, files: sourceFiles }),
    title: titleFromText(firstUserText, `Claude session ${externalSessionId.slice(0, 8)}`),
    summary: firstUserText ? compactText(firstUserText, 180) : null,
    workspacePath,
    gitIdentity: { ...emptyGitIdentity(), branch: gitBranch },
    createdAt,
    updatedAt,
    archived: false,
    estimatedBytes,
    childSessionCount: sourceFiles.filter(file => file.kind === 'subagent').length,
    sourceFiles,
  }
}

async function readClaudeSourceFiles(
  mainPath: string,
  externalSessionId: string,
  mainStat: Stats,
): Promise<ExternalSessionSourceFile[]> {
  const subagentRoot = join(dirname(mainPath), externalSessionId, 'subagents')
  const childPaths = (await listJsonlFiles(subagentRoot))
    .filter(path => basename(path).startsWith('agent-'))
    .sort()
  const children = (await Promise.all(childPaths.map(async (path) => {
    const fileStat = await stat(path)
    return {
      path,
      kind: 'subagent' as const,
      sourceId: basename(path, '.jsonl'),
      size: fileStat.size,
      modifiedAtMs: fileStat.mtimeMs,
    }
  })))
  return [{
    path: mainPath,
    kind: 'main',
    sourceId: externalSessionId,
    size: mainStat.size,
    modifiedAtMs: mainStat.mtimeMs,
  }, ...children]
}

async function readClaudeSession(
  descriptor: ExternalSessionDescriptor,
  files: ExternalSessionBundleFile[],
  bundle: Parameters<typeof openExternalSessionBundleFile>[0],
): Promise<ExternalSessionReadResult> {
  const mainFile = files.find(file => file.kind === 'main')
  if (!mainFile) {
    throw new Error(`Claude session ${descriptor.externalSessionId} bundle has no main JSONL file`)
  }
  const fidelity: ExternalSessionFidelityReport = {
    messages: 0,
    toolCalls: 0,
    reasoningParts: 0,
    omittedSystemEntries: 0,
    unavailableAttachments: 0,
    childSessions: files.filter(file => file.kind === 'subagent').length,
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

  for await (const line of lines) {
    lineNumber += 1
    const entry = parseClaudeEnvelope(line)
    if (!entry) {
      fidelity.preservedUnknownEntries += 1
      continue
    }
    if (entry.type === 'system') {
      fidelity.omittedSystemEntries += 1
      continue
    }
    if (!entry.message || !entry.uuid) {
      if (!['mode', 'permission-mode', 'file-history-snapshot', 'last-prompt', 'attachment'].includes(entry.type)) {
        fidelity.preservedUnknownEntries += 1
      }
      if (entry.type === 'attachment') {
        fidelity.unavailableAttachments += 1
      }
      continue
    }
    const blocks = typeof entry.message.content === 'string'
      ? [{ type: 'text', text: entry.message.content } satisfies ClaudeContentBlock]
      : entry.message.content
    const sourceEntryId = entry.uuid || `line-${lineNumber}`
    const createdAt = unixSeconds(entry.timestamp)

    if (entry.message.role === 'assistant') {
      pendingAssistant ??= createImportedMessage(descriptor, sourceEntryId, 'assistant', createdAt)
      appendSourceEntryId(pendingAssistant, sourceEntryId)
      for (const block of blocks) {
        const part = assistantPart(block, fidelity)
        if (part) {
          pendingAssistant.message.parts.push(part)
        }
      }
      continue
    }

    for (const block of blocks) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        applyClaudeToolResult(pendingAssistant, block)
      }
    }
    const parts = userParts(blocks, fidelity)
    if (parts.length > 0) {
      flushAssistant()
      messages.push(importedMessage({
        id: importedMessageId(descriptor, sourceEntryId),
        role: 'user',
        parts,
        sourceEntryIds: [sourceEntryId],
        createdAt,
        descriptor,
      }))
    }
  }
  flushAssistant()
  fidelity.messages = messages.length
  return { descriptor, contentHash: createContentHash(messages), messages, fidelity }
}

function createImportedMessage(
  descriptor: ExternalSessionDescriptor,
  sourceEntryId: string,
  role: 'assistant',
  createdAt: number | null,
): ExternalSessionImportMessage {
  return importedMessage({
    id: importedMessageId(descriptor, sourceEntryId),
    role,
    parts: [],
    sourceEntryIds: [],
    createdAt,
    descriptor,
  })
}

function appendSourceEntryId(message: ExternalSessionImportMessage, sourceEntryId: string): void {
  if (!message.sourceEntryIds.includes(sourceEntryId)) {
    message.sourceEntryIds.push(sourceEntryId)
  }
  const metadata = message.message.metadata as { externalImport: { sourceEntryIds: string[] } }
  metadata.externalImport.sourceEntryIds = [...message.sourceEntryIds]
}

function assistantPart(
  block: ClaudeContentBlock,
  fidelity: ExternalSessionFidelityReport,
): UIMessage['parts'][number] | null {
  if (block.type === 'text' && block.text) {
    return { type: 'text', text: block.text }
  }
  if (block.type === 'thinking' && (block.thinking || block.text)) {
    fidelity.reasoningParts += 1
    return { type: 'reasoning', text: block.thinking ?? block.text ?? '' }
  }
  if (block.type === 'tool_use' && block.id && block.name) {
    fidelity.toolCalls += 1
    return {
      type: `tool-${block.name}`,
      toolCallId: block.id,
      state: 'input-available',
      input: block.input ?? {},
    } as UIMessage['parts'][number]
  }
  return null
}

function userParts(
  blocks: ClaudeContentBlock[],
  fidelity: ExternalSessionFidelityReport,
): UIMessage['parts'] {
  const parts: UIMessage['parts'] = []
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push({ type: 'text', text: block.text })
    }
    else if (block.type === 'image') {
      fidelity.unavailableAttachments += 1
      parts.push({ type: 'text', text: '[Imported image was unavailable]' })
    }
  }
  return parts
}

function applyClaudeToolResult(
  assistant: ExternalSessionImportMessage | null,
  block: ClaudeContentBlock,
): void {
  const part = assistant?.message.parts.find(candidate =>
    (candidate as MutableToolPart).toolCallId === block.tool_use_id) as MutableToolPart | undefined
  if (!part) {
    return
  }
  part.state = block.is_error ? 'output-error' : 'output-available'
  if (block.is_error) {
    part.errorText = readClaudeToolResult(block.content)
  }
  else {
    part.output = block.content ?? ''
  }
}

function readClaudeUserText(content: z.infer<typeof ClaudeMessageSchema>['content']): string {
  if (typeof content === 'string') {
    return content
  }
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .filter(Boolean)
    .join('\n')
}

function readClaudeToolResult(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? '')
}

function parseClaudeEnvelope(line: string): ClaudeEnvelope | null {
  if (!line.trim()) {
    return null
  }
  try {
    const parsed = ClaudeEnvelopeSchema.safeParse(JSON.parse(line))
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
