import type { CradleToolKind } from '@cradle/chat-runtime-contracts'

import { formatCompactBytes } from '~/lib/number-format'

import {
  readBuiltinToolCallIdentity,
  readBuiltinToolCallInputPayload,
  readBuiltinToolCallResultPayload,
} from './chat-tool-entities'

export type ToolState
  = | 'input-streaming'
    | 'input-available'
    | 'approval-requested'
    | 'approval-responded'
    | 'output-available'
    | 'output-error'
    | 'output-denied'

/**
 * Cradle's canonical tool-call vocabulary, computed server-side per provider
 * (see `chat-runtime-providers/tools/README.md`) and carried on the builtin
 * tool-call envelope. Re-exported here so existing UI code keeps its name.
 */
export type ToolUiKind = CradleToolKind

interface BaseRenderableToolPart {
  type: string
  toolCallId: string
  state: ToolState
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

export type RenderableToolPart
  = | (BaseRenderableToolPart & {
    type: 'dynamic-tool'
    toolName: string
  })
  | (BaseRenderableToolPart & {
    type: `tool-${string}`
    toolName?: string
  })

export interface ToolUiDescriptor {
  kind: ToolUiKind
  toolName: string
  displayName: string
  title: string
  target: string | null
  summary: string | null
}

interface ToolUiDescriptorCacheEntry {
  signature: string
  descriptor: ToolUiDescriptor
}

const FUNCTIONS_PREFIX_PATTERN = /^functions\./
const TOOL_NAME_SEPARATOR_PATTERN = /[-\s]/g
const MCP_PREFIX_PATTERN = /^mcp__/
const DOUBLE_UNDERSCORE_PATTERN = /__/g
const UNDERSCORE_OR_DASH_PATTERN = /[_-]/g
const LOWER_TO_UPPER_PATTERN = /([a-z])([A-Z])/g
const WHITESPACE_PATTERN = /\s+/
const JSON_WHITESPACE_PATTERN = /\s/
const JSON_PRIMITIVE_PATTERN = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i
const LINE_BREAK_PATTERN = /\r?\n/
const toolUiDescriptorCache = new WeakMap<RenderableToolPart, ToolUiDescriptorCacheEntry>()
const objectIdentityTokens = new WeakMap<object, number>()
let nextObjectIdentityToken = 1

interface ToolContentBlock {
  text: string | null
  title: string | null
  url: string | null
  uri: string | null
}

interface ToolFile {
  filePath: string | null
  type: string | null
  base64: string | null
  content: string | null
  originalSize: number | null
  count: number | null
  outputDir: string | null
  numLines: number | null
  totalLines: number | null
}

interface ToolGitDiff {
  additions: number
  deletions: number
  patch: string
}

interface ToolPatchHunk {
  lines: string[]
}

export interface ToolTodo {
  id: string | null
  content: string | null
  activeForm: string | null
  status: string | null
}

interface ToolWebResult {
  content: ToolContentBlock[]
}

export interface WorkflowPhase {
  name: string
  description: string | null
}

interface WorkflowMeta {
  name: string | null
  description: string | null
  phases: WorkflowPhase[]
}

type WorkflowLiteral
  = | string
    | number
    | boolean
    | null
    | WorkflowLiteral[]
    | { [key: string]: WorkflowLiteral }

interface ToolObjectPayload {
  input: string | null
  description: string | null
  explanation: string | null
  goal: string | null
  title: string | null
  task: string | null
  active_form: string | null
  type: string | null
  file_path: string | null
  filePath: string | null
  path: string | null
  file: { path: string | null, file: ToolFile | null }
  filename: string | null
  notebook_path: string | null
  command: string | null
  cmd: string | null
  timeout: number | null
  pattern: string | null
  query: string | null
  glob: string | null
  url: string | null
  name: string | null
  subagent_type: string | null
  team_name: string | null
  agentId: string | null
  agentType: string | null
  task_id: string | null
  taskId: string | null
  shell_id: string | null
  task_type: string | null
  taskType: string | null
  turnId: string | null
  script: string | null
  workflowName: string | null
  workflowDescription: string | null
  workflowPhases: WorkflowPhase[]
  runId: string | null
  transcriptDir: string | null
  scriptPath: string | null
  sessionUrl: string | null
  warning: string | null
  error: string | null
  plan: string | null
  planContent: string | null
  server: string | null
  uri: string | null
  tool: string | null
  worktreePath: string | null
  worktreeBranch: string | null
  action: string | null
  edit_mode: string | null
  cell_type: string | null
  message: string | null
  stdout: string | null
  stderr: string | null
  output: string | null
  result: string | null
  content: { text: string | null, blocks: ToolContentBlock[] }
  text: string | null
  backgroundTaskId: string | null
  interrupted: boolean | null
  noOutputExpected: boolean | null
  numFiles: number | null
  numMatches: number | null
  code: number | null
  bytes: number | null
  durationSeconds: number | null
  status: string | null
  totalToolUseCount: number | null
  totalTokens: number | null
  pages: string | null
  old_string: string | null
  oldString: string | null
  new_string: string | null
  newString: string | null
  originalFile: string | null
  original_file: string | null
  replace_all: boolean | null
  replaceAll: boolean | null
  userModified: boolean | null
  structuredPatch: ToolPatchHunk[]
  gitDiff: ToolGitDiff
  filenames: string[]
  results: ToolWebResult[]
  contents: ToolContentBlock[]
  outputFile: string | null
  newTodos: ToolTodo[]
  todos: ToolTodo[]
  tasks: ToolTodo[]
  items: ToolTodo[]
  questions: unknown[]
  allowedPrompts: unknown[]
  answers: Record<string, unknown> | null
  mode: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readContentBlock(value: unknown): ToolContentBlock {
  const record = isRecord(value) ? value : {}
  return {
    text: readNullableString(record.text),
    title: readNullableString(record.title),
    url: readNullableString(record.url),
    uri: readNullableString(record.uri),
  }
}

function readContentBlocks(value: unknown): ToolContentBlock[] {
  return Array.isArray(value) ? value.map(readContentBlock) : []
}

function readContentValue(value: unknown): { text: string | null, blocks: ToolContentBlock[] } {
  if (typeof value === 'string') {
    return { text: value, blocks: [] }
  }
  if (Array.isArray(value)) {
    return { text: null, blocks: readContentBlocks(value) }
  }
  return { text: null, blocks: [] }
}

function readToolFile(value: unknown): ToolFile {
  const record = isRecord(value) ? value : {}
  return {
    filePath: readNullableString(record.filePath),
    type: readNullableString(record.type),
    base64: readNullableString(record.base64),
    content: readNullableString(record.content),
    originalSize: readNullableNumber(record.originalSize),
    count: readNullableNumber(record.count),
    outputDir: readNullableString(record.outputDir),
    numLines: readNullableNumber(record.numLines),
    totalLines: readNullableNumber(record.totalLines),
  }
}

function readToolFileValue(value: unknown): { path: string | null, file: ToolFile | null } {
  if (typeof value === 'string') {
    return { path: value, file: null }
  }
  if (isRecord(value)) {
    const file = readToolFile(value)
    return { path: file.filePath, file }
  }
  return { path: null, file: null }
}

function readGitDiff(value: unknown): ToolGitDiff {
  const record = isRecord(value) ? value : {}
  return {
    additions: readNullableNumber(record.additions) ?? 0,
    deletions: readNullableNumber(record.deletions) ?? 0,
    patch: readNullableString(record.patch) ?? '',
  }
}

function readPatchHunks(value: unknown): ToolPatchHunk[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => {
    const record = isRecord(item) ? item : {}
    return { lines: readStringList(record.lines) }
  })
}

function readTodos(value: unknown): ToolTodo[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => {
    const record = isRecord(item) ? item : {}
    return {
      id: readNullableString(record.id) ?? readNullableString(record.task_id),
      content: readNullableString(record.content) ?? readNullableString(record.title) ?? readNullableString(record.task) ?? readNullableString(record.description),
      activeForm: readNullableString(record.activeForm) ?? readNullableString(record.active_form),
      status: readNullableString(record.status),
    }
  })
}

function readWebResults(value: unknown): ToolWebResult[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => {
    const record = isRecord(item) ? item : {}
    return { content: readContentBlocks(record.content) }
  })
}

function readUnknownList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readAnswers(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function readWorkflowMeta(script: string | null): WorkflowMeta | null {
  if (!script) {
    return null
  }

  const value = readWorkflowMetaLiteral(script)
  if (!isWorkflowLiteralRecord(value)) {
    return null
  }

  const name = readWorkflowLiteralString(value.name)
  const description = readWorkflowLiteralString(value.description)
  const phases = readWorkflowPhases(value.phases)
  if (!name && !description && phases.length === 0) {
    return null
  }

  return { name, description, phases }
}

function readWorkflowMetaLiteral(script: string): WorkflowLiteral | null {
  let index = skipWorkflowLiteralSpace(script, 0)
  index = readWorkflowKeyword(script, index, 'export')
  if (index < 0) {
    return null
  }
  index = readWorkflowKeyword(script, index, 'const')
  if (index < 0) {
    return null
  }
  index = readWorkflowKeyword(script, index, 'meta')
  if (index < 0) {
    return null
  }
  index = skipWorkflowLiteralSpace(script, index)
  if (script[index] === ':') {
    index = script.indexOf('=', index + 1)
    if (index < 0) {
      return null
    }
  }
  if (script[index] !== '=') {
    return null
  }

  return parseWorkflowLiteralValue(script, index + 1)?.value ?? null
}

function readWorkflowKeyword(text: string, start: number, keyword: string): number {
  const index = skipWorkflowLiteralSpace(text, start)
  if (text.slice(index, index + keyword.length) !== keyword) {
    return -1
  }
  const next = index + keyword.length
  if (isWorkflowIdentifierChar(text[next] ?? '')) {
    return -1
  }
  return next
}

function parseWorkflowLiteralValue(text: string, start: number): { value: WorkflowLiteral, next: number } | null {
  const index = skipWorkflowLiteralSpace(text, start)
  const char = text[index]
  if (char === '{') {
    return parseWorkflowLiteralObject(text, index)
  }
  if (char === '[') {
    return parseWorkflowLiteralArray(text, index)
  }
  if (char === '\'' || char === '"' || char === '`') {
    return parseWorkflowLiteralString(text, index)
  }
  return parseWorkflowLiteralPrimitive(text, index)
}

function parseWorkflowLiteralObject(text: string, start: number): { value: WorkflowLiteral, next: number } | null {
  const value: Record<string, WorkflowLiteral> = {}
  let index = skipWorkflowLiteralSpace(text, start + 1)
  while (index < text.length && text[index] !== '}') {
    const key = parseWorkflowLiteralKey(text, index)
    if (!key) {
      return null
    }
    index = skipWorkflowLiteralSpace(text, key.next)
    if (text[index] !== ':') {
      return null
    }
    const parsedValue = parseWorkflowLiteralValue(text, index + 1)
    if (!parsedValue) {
      return null
    }
    value[key.value] = parsedValue.value
    index = skipWorkflowLiteralSpace(text, parsedValue.next)
    if (text[index] === ',') {
      index = skipWorkflowLiteralSpace(text, index + 1)
      continue
    }
    if (text[index] !== '}') {
      return null
    }
  }
  return text[index] === '}' ? { value, next: index + 1 } : null
}

function parseWorkflowLiteralArray(text: string, start: number): { value: WorkflowLiteral, next: number } | null {
  const value: WorkflowLiteral[] = []
  let index = skipWorkflowLiteralSpace(text, start + 1)
  while (index < text.length && text[index] !== ']') {
    const item = parseWorkflowLiteralValue(text, index)
    if (!item) {
      return null
    }
    value.push(item.value)
    index = skipWorkflowLiteralSpace(text, item.next)
    if (text[index] === ',') {
      index = skipWorkflowLiteralSpace(text, index + 1)
      continue
    }
    if (text[index] !== ']') {
      return null
    }
  }
  return text[index] === ']' ? { value, next: index + 1 } : null
}

function parseWorkflowLiteralKey(text: string, start: number): { value: string, next: number } | null {
  const index = skipWorkflowLiteralSpace(text, start)
  const char = text[index]
  if (char === '\'' || char === '"' || char === '`') {
    return parseWorkflowLiteralString(text, index)
  }
  if (!isWorkflowIdentifierStart(char ?? '')) {
    return null
  }
  let next = index + 1
  while (isWorkflowIdentifierChar(text[next] ?? '')) {
    next += 1
  }
  return { value: text.slice(index, next), next }
}

function parseWorkflowLiteralString(text: string, start: number): { value: string, next: number } | null {
  const quote = text[start]
  let value = ''
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (char === quote) {
      return { value, next: index + 1 }
    }
    if (quote === '`' && char === '$' && text[index + 1] === '{') {
      return null
    }
    if (char === '\\') {
      const escaped = text[index + 1]
      if (escaped === undefined) {
        return null
      }
      value += readWorkflowEscapedChar(escaped)
      index += 1
      continue
    }
    value += char
  }
  return null
}

function parseWorkflowLiteralPrimitive(text: string, start: number): { value: WorkflowLiteral, next: number } | null {
  let next = start
  while (next < text.length && !/[\s,}\]]/.test(text[next] ?? '')) {
    next += 1
  }
  const token = text.slice(start, next)
  switch (token) {
    case 'true':
      return { value: true, next }
    case 'false':
      return { value: false, next }
    case 'null':
      return { value: null, next }
    default: {
      const number = Number(token)
      return token && Number.isFinite(number) ? { value: number, next } : null
    }
  }
}

function skipWorkflowLiteralSpace(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const char = text[index]
    if (char && /\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      const nextLine = text.indexOf('\n', index + 2)
      index = nextLine < 0 ? text.length : nextLine + 1
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2)
      index = end < 0 ? text.length : end + 2
      continue
    }
    break
  }
  return index
}

function readWorkflowEscapedChar(char: string): string {
  switch (char) {
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    default:
      return char
  }
}

function isWorkflowIdentifierStart(char: string): boolean {
  return /^[A-Z_$]$/i.test(char)
}

function isWorkflowIdentifierChar(char: string): boolean {
  return /^[\w$]$/.test(char)
}

function isWorkflowLiteralRecord(value: WorkflowLiteral | null): value is Record<string, WorkflowLiteral> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readWorkflowLiteralString(value: WorkflowLiteral | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readWorkflowPhases(value: WorkflowLiteral | undefined): WorkflowPhase[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((phase): WorkflowPhase[] => {
    if (typeof phase === 'string') {
      const name = phase.trim()
      return name ? [{ name, description: null }] : []
    }
    if (!isWorkflowLiteralRecord(phase)) {
      return []
    }
    const name = readWorkflowLiteralString(phase.name)
      ?? readWorkflowLiteralString(phase.title)
      ?? readWorkflowLiteralString(phase.description)
    if (!name) {
      return []
    }
    return [{
      name,
      description: readWorkflowLiteralString(phase.description),
    }]
  })
}

function readToolObjectPayload(value: unknown): ToolObjectPayload {
  const record = isRecord(value) ? value : {}
  const script = readNullableString(record.script)
  const workflowMeta = readWorkflowMeta(script)
  return {
    input: readNullableString(record.input),
    description: readNullableString(record.description),
    explanation: readNullableString(record.explanation),
    goal: readNullableString(record.goal),
    title: readNullableString(record.title),
    task: readNullableString(record.task),
    active_form: readNullableString(record.active_form),
    type: readNullableString(record.type),
    file_path: readNullableString(record.file_path),
    filePath: readNullableString(record.filePath),
    path: readNullableString(record.path),
    file: readToolFileValue(record.file),
    filename: readNullableString(record.filename),
    notebook_path: readNullableString(record.notebook_path),
    command: readNullableString(record.command),
    cmd: readNullableString(record.cmd),
    timeout: readNullableNumber(record.timeout),
    pattern: readNullableString(record.pattern),
    query: readNullableString(record.query),
    glob: readNullableString(record.glob),
    url: readNullableString(record.url),
    name: readNullableString(record.name),
    subagent_type: readNullableString(record.subagent_type),
    team_name: readNullableString(record.team_name),
    agentId: readNullableString(record.agentId),
    agentType: readNullableString(record.agentType),
    task_id: readNullableString(record.task_id),
    taskId: readNullableString(record.taskId),
    shell_id: readNullableString(record.shell_id),
    task_type: readNullableString(record.task_type),
    taskType: readNullableString(record.taskType),
    turnId: readNullableString(record.turnId),
    script,
    workflowName: readNullableString(record.workflowName) ?? workflowMeta?.name ?? null,
    workflowDescription: workflowMeta?.description ?? null,
    workflowPhases: workflowMeta?.phases ?? [],
    runId: readNullableString(record.runId),
    transcriptDir: readNullableString(record.transcriptDir),
    scriptPath: readNullableString(record.scriptPath),
    sessionUrl: readNullableString(record.sessionUrl),
    warning: readNullableString(record.warning),
    error: readNullableString(record.error),
    plan: readNullableString(record.plan),
    planContent: readNullableString(record.planContent),
    server: readNullableString(record.server),
    uri: readNullableString(record.uri),
    tool: readNullableString(record.tool),
    worktreePath: readNullableString(record.worktreePath),
    worktreeBranch: readNullableString(record.worktreeBranch),
    action: readNullableString(record.action),
    edit_mode: readNullableString(record.edit_mode),
    cell_type: readNullableString(record.cell_type),
    message: readNullableString(record.message),
    stdout: readNullableString(record.stdout),
    stderr: readNullableString(record.stderr),
    output: readNullableString(record.output),
    result: readNullableString(record.result),
    content: readContentValue(record.content),
    text: readNullableString(record.text),
    backgroundTaskId: readNullableString(record.backgroundTaskId),
    interrupted: readNullableBoolean(record.interrupted),
    noOutputExpected: readNullableBoolean(record.noOutputExpected),
    numFiles: readNullableNumber(record.numFiles),
    numMatches: readNullableNumber(record.numMatches),
    code: readNullableNumber(record.code),
    bytes: readNullableNumber(record.bytes),
    durationSeconds: readNullableNumber(record.durationSeconds),
    status: readNullableString(record.status),
    totalToolUseCount: readNullableNumber(record.totalToolUseCount),
    totalTokens: readNullableNumber(record.totalTokens),
    pages: readNullableString(record.pages),
    old_string: readNullableString(record.old_string),
    oldString: readNullableString(record.oldString),
    new_string: readNullableString(record.new_string),
    newString: readNullableString(record.newString),
    originalFile: readNullableString(record.originalFile),
    original_file: readNullableString(record.original_file),
    replace_all: readNullableBoolean(record.replace_all),
    replaceAll: readNullableBoolean(record.replaceAll),
    userModified: readNullableBoolean(record.userModified),
    structuredPatch: readPatchHunks(record.structuredPatch),
    gitDiff: readGitDiff(record.gitDiff),
    filenames: readStringList(record.filenames),
    results: readWebResults(record.results),
    contents: readContentBlocks(record.contents),
    outputFile: readNullableString(record.outputFile),
    newTodos: readTodos(record.newTodos),
    todos: readTodos(record.todos),
    tasks: readTodos(record.tasks),
    items: readTodos(record.items),
    questions: readUnknownList(record.questions),
    allowedPrompts: readUnknownList(record.allowedPrompts),
    answers: readAnswers(record.answers),
    mode: readNullableString(record.mode),
  }
}

export interface ToolPayload {
  rawText: string | null
  inputText: string | null
  description: string | null
  type: string | null
  filePath: string | null
  notebookPath: string | null
  command: string | null
  timeout: number | null
  pattern: string | null
  query: string | null
  url: string | null
  subagentName: string | null
  agentId: string | null
  agentType: string | null
  taskId: string | null
  taskType: string | null
  turnId: string | null
  workflowName: string | null
  workflowDescription: string | null
  workflowPhases: WorkflowPhase[]
  workflowRunId: string | null
  workflowTranscriptDir: string | null
  workflowScriptPath: string | null
  workflowSessionUrl: string | null
  warning: string | null
  error: string | null
  plan: string | null
  planContent: string | null
  mcpTarget: string | null
  worktreeTarget: string | null
  worktreeBranch: string | null
  action: string | null
  editMode: string | null
  cellType: string | null
  message: string | null
  stdout: string | null
  stderr: string | null
  outputText: string | null
  contentText: string | null
  text: string | null
  backgroundTaskId: string | null
  interrupted: boolean | null
  noOutputExpected: boolean | null
  numFiles: number | null
  numMatches: number | null
  code: number | null
  bytes: number | null
  durationSeconds: number | null
  status: string | null
  totalToolUseCount: number | null
  totalTokens: number | null
  pages: string | null
  oldString: string | null
  newString: string | null
  originalFile: string | null
  replaceAll: boolean | null
  userModified: boolean | null
  file: ToolFile | null
  gitDiff: ToolGitDiff
  structuredPatch: ToolPatchHunk[]
  filenames: string[]
  results: ToolWebResult[]
  contentBlocks: ToolContentBlock[]
  contents: ToolContentBlock[]
  outputFile: string | null
  todos: ToolTodo[]
  newTodos: ToolTodo[]
  tasks: ToolTodo[]
  items: ToolTodo[]
  questions: unknown[]
  allowedPrompts: unknown[]
  answers: Record<string, unknown> | null
  mode: string | null
}

function toolPayloadFromObject(value: ToolObjectPayload): ToolPayload {
  return {
    rawText: null,
    inputText: value.input,
    description: value.description ?? value.workflowDescription ?? value.explanation ?? value.goal ?? value.title ?? value.task,
    type: value.type,
    filePath: value.file_path ?? value.filePath ?? value.path ?? value.file.path ?? value.filename,
    notebookPath: value.notebook_path,
    command: value.command ?? value.cmd,
    timeout: value.timeout,
    pattern: value.pattern ?? value.query ?? value.glob,
    query: value.query,
    url: value.url,
    subagentName: value.name ?? value.workflowName ?? value.subagent_type ?? value.team_name,
    agentId: value.agentId,
    agentType: value.agentType,
    taskId: value.task_id ?? value.taskId ?? value.shell_id,
    taskType: value.task_type ?? value.taskType,
    turnId: value.turnId,
    workflowName: value.workflowName,
    workflowDescription: value.workflowDescription,
    workflowPhases: value.workflowPhases,
    workflowRunId: value.runId,
    workflowTranscriptDir: value.transcriptDir,
    workflowScriptPath: value.scriptPath,
    workflowSessionUrl: value.sessionUrl,
    warning: value.warning,
    error: value.error,
    plan: value.plan,
    planContent: value.planContent,
    mcpTarget: value.server ?? value.uri ?? value.tool,
    worktreeTarget: value.path ?? value.name ?? value.worktreePath ?? value.worktreeBranch,
    worktreeBranch: value.worktreeBranch,
    action: value.action,
    editMode: value.edit_mode,
    cellType: value.cell_type,
    message: value.message,
    stdout: value.stdout,
    stderr: value.stderr,
    outputText: value.output ?? value.result,
    contentText: value.content.text,
    text: value.text,
    backgroundTaskId: value.backgroundTaskId,
    interrupted: value.interrupted,
    noOutputExpected: value.noOutputExpected,
    numFiles: value.numFiles,
    numMatches: value.numMatches,
    code: value.code,
    bytes: value.bytes,
    durationSeconds: value.durationSeconds,
    status: value.status,
    totalToolUseCount: value.totalToolUseCount,
    totalTokens: value.totalTokens,
    pages: value.pages,
    oldString: value.old_string ?? value.oldString,
    newString: value.new_string ?? value.newString,
    originalFile: value.originalFile ?? value.original_file,
    replaceAll: value.replace_all ?? value.replaceAll,
    userModified: value.userModified,
    file: value.file.file,
    gitDiff: value.gitDiff,
    structuredPatch: value.structuredPatch,
    filenames: value.filenames,
    results: value.results,
    contentBlocks: value.content.blocks,
    contents: value.contents,
    outputFile: value.outputFile,
    todos: value.todos,
    newTodos: value.newTodos,
    tasks: value.tasks,
    items: value.items,
    questions: value.questions,
    allowedPrompts: value.allowedPrompts,
    answers: value.answers,
    mode: value.mode,
  }
}

export function readToolPayload(value: unknown): ToolPayload {
  const builtinResult = readBuiltinToolCallResultPayload(value)
  if (builtinResult) {
    return readToolPayload(builtinResult.result)
  }
  const builtinInput = readBuiltinToolCallInputPayload(value)
  if (builtinInput) {
    return readToolPayload(builtinInput.args)
  }
  if (typeof value === 'string') {
    return {
      ...toolPayloadFromObject(readToolObjectPayload({})),
      rawText: value,
    }
  }
  if (Array.isArray(value)) {
    return toolPayloadFromObject(readToolObjectPayload({ contents: value }))
  }
  return toolPayloadFromObject(readToolObjectPayload(value))
}

export function readToolInputPayload(input: unknown, argumentsText?: string): ToolPayload {
  const inputPayload = readToolPayload(input)
  if (argumentsText === undefined || !hasNoToolInputPayload(input)) {
    return inputPayload
  }

  const argumentsObject = parsePartialJsonObject(argumentsText)
  const argumentsPayload = readToolPayload(argumentsObject)
  return {
    ...argumentsPayload,
    rawText: argumentsText,
    inputText: argumentsText,
  }
}

function hasNoToolInputPayload(input: unknown): boolean {
  if (input === undefined || input === null) {
    return true
  }

  const builtinInput = readBuiltinToolCallInputPayload(input)
  if (builtinInput) {
    return hasNoToolInputPayload(builtinInput.args)
  }

  return isRecord(input) && Object.keys(input).length === 0
}

export function describeToolCall(part: RenderableToolPart): ToolUiDescriptor {
  const builtinIdentity = readBuiltinToolCallIdentity(part.input, part.output)
  const toolName = builtinIdentity?.apiName ?? part.toolName ?? part.type
  const input = readToolInputPayload(part.input, part.argumentsText)
  const output = readToolPayload(part.output)
  const kind = builtinIdentity?.kind ?? 'generic'
  const displayName = formatToolName(toolName)
  const target = readToolTarget(kind, input, output)
  return {
    kind,
    toolName,
    displayName,
    title: readToolTitle(kind, displayName, input, output),
    target,
    summary: readToolSummary(kind, input, output),
  }
}

export function describeToolCallCached(part: RenderableToolPart): ToolUiDescriptor {
  const signature = buildToolDescriptorCacheSignature(part)
  const cached = toolUiDescriptorCache.get(part)
  if (cached?.signature === signature) {
    return cached.descriptor
  }

  const descriptor = describeToolCall(part)
  toolUiDescriptorCache.set(part, { signature, descriptor })
  return descriptor
}

function buildToolDescriptorCacheSignature(part: RenderableToolPart): string {
  return [
    part.type,
    part.toolCallId,
    part.state,
    part.toolName ?? '',
    part.argumentsText ?? '',
    part.errorText ?? '',
    readCacheValueToken(part.input),
    readCacheValueToken(part.output),
  ].join('\u0000')
}

function readCacheValueToken(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  const valueType = typeof value
  if (valueType !== 'object' && valueType !== 'function') {
    return `${valueType}:${String(value)}`
  }

  const objectValue = value as object
  let token = objectIdentityTokens.get(objectValue)
  if (token === undefined) {
    token = nextObjectIdentityToken++
    objectIdentityTokens.set(objectValue, token)
  }
  return `${valueType}:${token}`
}

function parsePartialJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) {
    return {}
  }

  try {
    const parsed = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : {}
  }
  catch {
    return parseTopLevelObjectPrefix(trimmed)
  }
}

function parseTopLevelObjectPrefix(text: string): Record<string, unknown> {
  if (!text.startsWith('{')) {
    return {}
  }

  const object: Record<string, unknown> = {}
  let index = 1
  while (index < text.length) {
    index = skipJsonSeparators(text, index)
    if (text[index] === '}') {
      break
    }
    if (text[index] !== '"') {
      break
    }

    const key = readJsonString(text, index)
    if (!key.complete) {
      break
    }
    index = skipJsonWhitespace(text, key.next)
    if (text[index] !== ':') {
      break
    }
    index = skipJsonWhitespace(text, index + 1)

    const value = readJsonValue(text, index)
    if (value.read) {
      object[key.value] = value.value
    }
    index = value.next
    if (!value.complete) {
      break
    }
  }

  return object
}

function skipJsonSeparators(text: string, index: number): number {
  let nextIndex = skipJsonWhitespace(text, index)
  while (text[nextIndex] === ',') {
    nextIndex = skipJsonWhitespace(text, nextIndex + 1)
  }
  return nextIndex
}

function skipJsonWhitespace(text: string, index: number): number {
  let nextIndex = index
  while (JSON_WHITESPACE_PATTERN.test(text[nextIndex] ?? '')) {
    nextIndex += 1
  }
  return nextIndex
}

function readJsonString(text: string, start: number): { value: string, next: number, complete: boolean } {
  let escaped = false
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      return {
        value: JSON.parse(text.slice(start, index + 1)) as string,
        next: index + 1,
        complete: true,
      }
    }
  }

  return {
    value: readPartialJsonStringText(text, start),
    next: text.length,
    complete: false,
  }
}

function readPartialJsonStringText(text: string, start: number): string {
  let value = ''
  let escaped = false
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (escaped) {
      value += readEscapedJsonChar(char)
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      break
    }
    value += char
  }
  return value
}

function readEscapedJsonChar(char: string): string {
  switch (char) {
    case '"':
    case '\\':
    case '/':
      return char
    case 'b':
      return '\b'
    case 'f':
      return '\f'
    case 'n':
      return '\n'
    case 'r':
      return '\r'
    case 't':
      return '\t'
    case 'u':
      return ''
    default:
      return char
  }
}

function readJsonValue(text: string, start: number): { value: unknown, next: number, complete: boolean, read: boolean } {
  const first = text[start]
  if (first === '"') {
    const value = readJsonString(text, start)
    return { value: value.value, next: value.next, complete: value.complete, read: true }
  }
  if (first === '{' || first === '[') {
    return readJsonContainer(text, start)
  }

  const tokenEnd = readPrimitiveEnd(text, start)
  const token = text.slice(start, tokenEnd).trim()
  if (!token) {
    return { value: undefined, next: tokenEnd, complete: false, read: false }
  }

  if (token === 'true' || token === 'false' || token === 'null' || JSON_PRIMITIVE_PATTERN.test(token)) {
    return {
      value: JSON.parse(token),
      next: tokenEnd,
      complete: tokenEnd < text.length,
      read: true,
    }
  }

  return { value: undefined, next: tokenEnd, complete: false, read: false }
}

function readPrimitiveEnd(text: string, start: number): number {
  let index = start
  while (index < text.length && text[index] !== ',' && text[index] !== '}') {
    index += 1
  }
  return index
}

function readJsonContainer(text: string, start: number): { value: unknown, next: number, complete: boolean, read: boolean } {
  const opening = text[start]
  const stack = [opening]
  let inString = false
  let escaped = false

  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      }
      else if (char === '\\') {
        escaped = true
      }
      else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{' || char === '[') {
      stack.push(char)
      continue
    }
    if (char === '}' || char === ']') {
      const previous = stack.pop()
      if ((previous === '{' && char !== '}') || (previous === '[' && char !== ']')) {
        break
      }
      if (stack.length === 0) {
        return {
          value: JSON.parse(text.slice(start, index + 1)),
          next: index + 1,
          complete: true,
          read: true,
        }
      }
    }
  }

  return { value: undefined, next: text.length, complete: false, read: false }
}

export function normalizeToolName(toolName: string): string {
  return toolName
    .trim()
    .replace(FUNCTIONS_PREFIX_PATTERN, '')
    .replace(TOOL_NAME_SEPARATOR_PATTERN, '_')
    .toLowerCase()
}

export function classifyToolKind(_toolName: string, _input: ToolPayload, _output: ToolPayload): ToolUiKind {
  return 'generic'
}

export function formatToolName(toolName: string): string {
  const readable = toolName
    .replace(MCP_PREFIX_PATTERN, 'mcp ')
    .replace(DOUBLE_UNDERSCORE_PATTERN, ' / ')
    .replace(UNDERSCORE_OR_DASH_PATTERN, ' ')
    .replace(LOWER_TO_UPPER_PATTERN, '$1 $2')
    .trim()

  if (!readable) {
    return 'Tool'
  }

  return readable
    .split(WHITESPACE_PATTERN)
    .map(word => word === '/' ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function readToolTitle(kind: ToolUiKind, displayName: string, input: ToolPayload, output: ToolPayload): string {
  if (kind === 'todo') {
    return 'Update todos'
  }
  if (kind === 'plan') {
    return 'Plan'
  }
  if (kind === 'plan-implementation') {
    return 'Implement this plan?'
  }

  const description = input.description
  if (description) {
    return description
  }

  switch (kind) {
    case 'file-read':
      return 'Read file'
    case 'file-diff':
      return output.type === 'create' ? 'Create file' : 'Edit file'
    case 'notebook-diff':
      return 'Edit notebook'
    case 'terminal':
      return 'Run command'
    case 'search':
      return displayName.includes('Glob') ? 'Find files' : 'Search code'
    case 'web':
      return displayName.includes('Search') ? 'Search web' : 'Fetch web page'
    case 'subagent':
      return displayName.includes('Workflow') ? 'Run workflow' : 'Run subagent'
    case 'task-control':
      return displayName.includes('Stop') ? 'Stop task' : 'Read task output'
    case 'question':
      return 'Ask user'
    case 'mcp':
      return displayName
    case 'worktree':
      return displayName.includes('Exit') ? 'Exit worktree' : 'Enter worktree'
    case 'generic':
      return displayName
  }
}

function readToolTarget(kind: ToolUiKind, input: ToolPayload, output: ToolPayload): string | null {
  switch (kind) {
    case 'file-read':
    case 'file-diff':
      return input.filePath ?? output.filePath ?? input.filenames[0] ?? output.filenames[0] ?? null
    case 'notebook-diff':
      return input.notebookPath ?? output.notebookPath
    case 'terminal':
      return readFirstLine(input.command ?? output.command)
    case 'search':
      return input.pattern ?? output.query
    case 'web':
      return input.url ?? input.query ?? output.url ?? output.query
    case 'subagent':
      return input.subagentName
        ?? output.workflowName
        ?? output.subagentName
        ?? input.description
        ?? output.agentId
        ?? output.description
    case 'task-control':
      return input.taskId ?? output.taskId
    case 'todo': {
      const count = readTodoCount(input, output)
      return count === null ? null : `${count} item${count === 1 ? '' : 's'}`
    }
    case 'plan-implementation':
      return null
    case 'plan':
      return input.mode === 'plan' || output.mode === 'plan'
        ? 'plan'
        : output.filePath
    case 'question': {
      const count = readQuestionCount(input, output)
      return count === null ? null : `${count} question${count === 1 ? '' : 's'}`
    }
    case 'mcp':
      return input.mcpTarget ?? output.mcpTarget
    case 'worktree':
      return input.worktreeTarget ?? output.worktreeTarget
    case 'generic':
      return input.filePath ?? input.query ?? input.command ?? input.url
  }
}

function readToolSummary(kind: ToolUiKind, input: ToolPayload, output: ToolPayload): string | null {
  switch (kind) {
    case 'file-read':
      return readFileReadSummary(output)
    case 'file-diff':
      return readDiffSummary(input, output)
    case 'notebook-diff':
      return output.editMode ?? output.cellType
    case 'terminal':
      return readTerminalSummary(output)
    case 'search':
      return readSearchSummary(output)
    case 'web':
      return readWebSummary(output)
    case 'subagent':
      return readWorkflowPayload(input, output) ? readWorkflowSummary(input, output) : readSubagentSummary(output)
    case 'task-control':
      return output.message
    case 'todo':
      return readTodoSummary(input, output)
    case 'plan-implementation':
      return 'Awaiting implementation decision'
    case 'plan':
      return output.filePath
        ? 'Plan saved'
        : output.plan || output.text || input.plan || input.text || output.rawText
          ? 'Plan ready'
          : null
    case 'question':
      return output.answers ? 'Answered' : null
    case 'mcp':
      return readMcpSummary(output)
    case 'worktree':
      return output.message
    case 'generic':
      return null
  }
}

function readFirstLine(value: string | null): string | null {
  if (!value) {
    return null
  }
  return value.split(LINE_BREAK_PATTERN, 1)[0] ?? value
}

function readFileReadSummary(output: ToolPayload): string | null {
  const type = output.type
  const file = output.file
  if (type === 'text' && file) {
    const lines = file.numLines
    const total = file.totalLines
    if (lines !== null && total !== null) {
      return `${lines}/${total} lines`
    }
    if (lines !== null) {
      return `${lines} lines`
    }
  }
  if (type === 'image') {
    return 'Image preview'
  }
  if (type === 'pdf') {
    return 'PDF preview'
  }
  if (type === 'notebook') {
    return 'Notebook cells'
  }
  if (type === 'parts' && file) {
    const count = file.count
    return count === null ? 'Extracted pages' : `${count} pages`
  }
  if (type === 'file_unchanged') {
    return 'File unchanged'
  }
  return null
}

function readDiffSummary(input: ToolPayload, output: ToolPayload): string | null {
  const additions = output.gitDiff.additions
  const deletions = output.gitDiff.deletions
  if (additions !== 0 || deletions !== 0) {
    return `+${additions} -${deletions}`
  }
  if (output.gitDiff.patch.length > 0) {
    return 'Patch prepared'
  }
  if (output.structuredPatch.length > 0) {
    return `${output.structuredPatch.length} hunk${output.structuredPatch.length === 1 ? '' : 's'}`
  }
  if (input.contentText !== null) {
    return 'Write content'
  }
  return null
}
function readSearchSummary(output: ToolPayload): string | null {
  const files = output.numFiles
  const matches = output.numMatches
  if (files !== null && matches !== null) {
    return `${matches} matches in ${files} files`
  }
  if (files !== null) {
    return `${files} file${files === 1 ? '' : 's'}`
  }
  return null
}

function readWebSummary(output: ToolPayload): string | null {
  const code = output.code
  const bytes = output.bytes
  if (code !== null && bytes !== null) {
    return `${code} · ${formatCompactBytes(bytes)}`
  }
  const seconds = output.durationSeconds
  if (seconds !== null) {
    return `${seconds.toFixed(1)}s`
  }
  return null
}

function readTerminalSummary(output: ToolPayload): string | null {
  if (output.stderr !== null) {
    return 'stderr available'
  }
  if (output.stdout !== null) {
    return 'stdout available'
  }
  if (output.outputText !== null || output.rawText !== null) {
    return 'output available'
  }
  return null
}

function readSubagentSummary(output: ToolPayload): string | null {
  const status = output.status
  if (status === 'async_launched' || status === 'remote_launched') {
    return 'Running in background'
  }
  if (status === 'completed') {
    return 'Completed'
  }
  if (status === 'failed' || status === 'error') {
    return 'Failed'
  }
  const totalToolUseCount = output.totalToolUseCount
  const totalTokens = output.totalTokens
  if (totalToolUseCount !== null && totalTokens !== null) {
    return `${totalToolUseCount} tools · ${totalTokens} tokens`
  }
  return status
}

function readWorkflowPayload(input: ToolPayload, output: ToolPayload): boolean {
  return input.taskType === 'local_workflow'
    || output.taskType === 'local_workflow'
    || input.taskType === 'remote_agent'
    || output.taskType === 'remote_agent'
    || input.workflowName !== null
    || output.workflowName !== null
    || input.workflowDescription !== null
    || output.workflowDescription !== null
    || input.workflowPhases.length > 0
    || output.workflowPhases.length > 0
    || input.workflowRunId !== null
    || output.workflowRunId !== null
    || input.workflowScriptPath !== null
    || output.workflowScriptPath !== null
    || input.workflowSessionUrl !== null
    || output.workflowSessionUrl !== null
    || input.warning !== null
    || output.warning !== null
    || input.error !== null
    || output.error !== null
}

function readWorkflowSummary(input: ToolPayload, output: ToolPayload): string | null {
  if (output.error) {
    return 'Workflow error'
  }
  if (output.warning) {
    return 'Workflow warning'
  }
  switch (output.status) {
    case 'remote_launched':
      return 'Running remotely'
    case 'async_launched':
      return 'Running workflow'
    case 'completed':
      return 'Completed'
    case 'failed':
    case 'error':
      return 'Failed'
    case 'stopped':
      return 'Stopped'
    default: {
      const phases = output.workflowPhases.length > 0 ? output.workflowPhases : input.workflowPhases
      if (phases.length > 0) {
        return `${phases.length} declared phase${phases.length === 1 ? '' : 's'}`
      }
      return output.status ?? output.workflowRunId ?? null
    }
  }
}

function readTodoCount(input: ToolPayload, output: ToolPayload): number | null {
  const todos = readPrimaryTodos(input, output)
  return todos.length > 0 ? todos.length : null
}

function readTodoSummary(input: ToolPayload, output: ToolPayload): string | null {
  const todos = readPrimaryTodos(input, output)
  if (todos.length === 0) {
    return null
  }
  const completed = todos.filter(todo => todo.status === 'completed').length
  if (completed > 0) {
    return `${completed}/${todos.length} done`
  }
  return `${todos.length} todo${todos.length === 1 ? '' : 's'}`
}

export function readPrimaryTodos(input: ToolPayload, output: ToolPayload): ToolTodo[] {
  if (output.newTodos.length > 0) {
    return output.newTodos
  }
  if (output.todos.length > 0) {
    return output.todos
  }
  if (output.tasks.length > 0) {
    return output.tasks
  }
  if (output.items.length > 0) {
    return output.items
  }
  if (input.newTodos.length > 0) {
    return input.newTodos
  }
  if (input.todos.length > 0) {
    return input.todos
  }
  if (input.tasks.length > 0) {
    return input.tasks
  }
  return input.items
}

function readQuestionCount(input: ToolPayload, output: ToolPayload): number | null {
  return output.questions.length > 0
    ? output.questions.length
    : input.questions.length > 0
      ? input.questions.length
      : null
}

function readMcpSummary(output: ToolPayload): string | null {
  const blocks = output.contentBlocks.length > 0 ? output.contentBlocks : output.contents
  if (blocks.length > 0) {
    return `${blocks.length} content block${blocks.length === 1 ? '' : 's'}`
  }
  return output.rawText ? 'Tool result' : null
}
