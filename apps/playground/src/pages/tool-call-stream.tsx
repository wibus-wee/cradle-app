import { useMemo, useState } from 'react'

type ToolState = 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | 'output-denied'

interface DynamicToolPart {
  type: 'dynamic-tool'
  toolName: string
  toolCallId: string
  state: ToolState
}

interface TextPart {
  type: 'text' | 'reasoning'
  text: string
  state?: 'streaming' | 'done'
}

type MessagePart = DynamicToolPart | TextPart

type ChatPartDelta
  = | { seq: number, type: 'part_add', partIndex: number, part: MessagePart }
    | { seq: number, type: 'tool_arguments_append', partIndex: number, text: string }
    | { seq: number, type: 'tool_input_set', partIndex: number, input: unknown }
    | { seq: number, type: 'tool_output_set', partIndex: number, state: 'output-available' | 'output-error' | 'output-denied', output?: unknown, errorText?: string }

interface SimulatedEvent {
  label: string
  note: string
  delta: ChatPartDelta
}

interface SimulatedMessage {
  id: string
  role: 'assistant'
  parts: MessagePart[]
}

interface ToolEntity {
  messageId: string
  toolCallId: string
  toolName: string
  state: ToolState
  argumentsText?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

interface ToolPayload {
  rawText: string | null
  filePath: string | null
  command: string | null
  oldString: string | null
  newString: string | null
  contentText: string | null
  outputText: string | null
  file: { filePath: string | null, content: string | null, type: string | null } | null
}

const readToolStartPart: DynamicToolPart = {
  type: 'dynamic-tool',
  toolName: 'Read',
  toolCallId: 'call_read',
  state: 'input-streaming',
}

const editToolStartPart: DynamicToolPart = {
  type: 'dynamic-tool',
  toolName: 'Edit',
  toolCallId: 'call_edit',
  state: 'input-streaming',
}

const writeToolStartPart: DynamicToolPart = {
  type: 'dynamic-tool',
  toolName: 'Write',
  toolCallId: 'call_write',
  state: 'input-streaming',
}

const readInputObject = { file_path: '/Users/wibus/dev/Cradle/README.md' }
const readInputJson = JSON.stringify(readInputObject)
const readOutputText = [
  '1\\t<p align="center">',
  '2\\t  <p align="center">',
  '3\\t    <img src="./.github/Cradle.png" alt="Preview" width="182" />',
  '4\\t  </p>',
].join('\n')

const editInputObject = {
  replace_all: false,
  file_path: '/Users/wibus/dev/Cradle/README.md',
  old_string: '<pre align="center">\nWorking in Progress\n</pre>',
  new_string: '<pre align="center">\nWork In Progress\n</pre>',
}

const writeInputObject = {
  file_path: '/Users/wibus/dev/Cradle/tmp/generated-novel.html',
  content: [
    '<!doctype html>',
    '<html>',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <title>Generated Story</title>',
    '</head>',
    '<body>',
    '  <main>',
    '    <h1>The Long Debugging Night</h1>',
    '    <p>The editor watched the stream of characters form a page before the tool finished.</p>',
    '    <p>Every argument chunk changed the visible card, proving the UI no longer waited for output.</p>',
    '  </main>',
    '</body>',
    '</html>',
  ].join('\n'),
}

const editInputJson = JSON.stringify(editInputObject)
const writeInputJson = JSON.stringify(writeInputObject)

const STREAM_EVENTS: SimulatedEvent[] = [
  {
    label: 'Read part_add',
    note: 'The tool block is renderable immediately with an empty argumentsText field.',
    delta: { seq: 52, type: 'part_add', partIndex: 0, part: readToolStartPart },
  },
  {
    label: 'Read arguments chunk',
    note: 'The raw tool arguments stream into argumentsText instead of input.input.',
    delta: { seq: 53, type: 'tool_arguments_append', partIndex: 0, text: readInputJson },
  },
  {
    label: 'Read input set',
    note: 'Structured input arrives after argument streaming and preserves the raw argumentsText.',
    delta: { seq: 55, type: 'tool_input_set', partIndex: 0, input: readInputObject },
  },
  {
    label: 'Read output set',
    note: 'The result arrives after the block has already shown the target path.',
    delta: { seq: 56, type: 'tool_output_set', partIndex: 0, state: 'output-available', output: readOutputText },
  },
  {
    label: 'Edit part_add',
    note: 'A second tool starts without replacing a previous streamed part.',
    delta: { seq: 140, type: 'part_add', partIndex: 1, part: editToolStartPart },
  },
  {
    label: 'Edit arguments chunk 1',
    note: 'Partial JSON already contains the tool mode and starts exposing file_path.',
    delta: { seq: 141, type: 'tool_arguments_append', partIndex: 1, text: editInputJson.slice(0, 78) },
  },
  {
    label: 'Edit arguments chunk 2',
    note: 'The file path can be parsed before tool_input_set.',
    delta: { seq: 142, type: 'tool_arguments_append', partIndex: 1, text: editInputJson.slice(78, 150) },
  },
  {
    label: 'Edit arguments chunk 3',
    note: 'More text increases the live payload size while the tool is still preparing.',
    delta: { seq: 143, type: 'tool_arguments_append', partIndex: 1, text: editInputJson.slice(150) },
  },
  {
    label: 'Edit input set',
    note: 'Structured input replaces parser-derived fields only when the model finishes arguments.',
    delta: { seq: 144, type: 'tool_input_set', partIndex: 1, input: editInputObject },
  },
  {
    label: 'Edit output set',
    note: 'The final result changes state, not initial visibility.',
    delta: { seq: 145, type: 'tool_output_set', partIndex: 1, state: 'output-available', output: 'The file has been updated successfully.' },
  },
  {
    label: 'Write part_add',
    note: 'A long generated HTML write starts with a visible empty tool block.',
    delta: { seq: 200, type: 'part_add', partIndex: 2, part: writeToolStartPart },
  },
  {
    label: 'Write arguments chunk 1',
    note: 'The generated file path appears while the content string is still incomplete.',
    delta: { seq: 201, type: 'tool_arguments_append', partIndex: 2, text: writeInputJson.slice(0, 96) },
  },
  {
    label: 'Write arguments chunk 2',
    note: 'Long HTML content keeps growing inside argumentsText.',
    delta: { seq: 202, type: 'tool_arguments_append', partIndex: 2, text: writeInputJson.slice(96, 230) },
  },
  {
    label: 'Write arguments chunk 3',
    note: 'The card has enough raw payload to render a live size before execution finishes.',
    delta: { seq: 203, type: 'tool_arguments_append', partIndex: 2, text: writeInputJson.slice(230, 430) },
  },
  {
    label: 'Write arguments chunk 4',
    note: 'The complete arguments are now available, but the tool output has not arrived yet.',
    delta: { seq: 204, type: 'tool_arguments_append', partIndex: 2, text: writeInputJson.slice(430) },
  },
  {
    label: 'Write input set',
    note: 'The structured input lands after the live argument preview has already updated.',
    delta: { seq: 205, type: 'tool_input_set', partIndex: 2, input: writeInputObject },
  },
  {
    label: 'Write output set',
    note: 'Execution completes.',
    delta: { seq: 206, type: 'tool_output_set', partIndex: 2, state: 'output-available', output: 'Wrote 522 bytes.' },
  },
]

const INITIAL_MESSAGE: SimulatedMessage = {
  id: 'assistant-repro',
  role: 'assistant',
  parts: [],
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function applyDelta(message: SimulatedMessage, delta: ChatPartDelta): SimulatedMessage {
  const next: SimulatedMessage = {
    ...message,
    parts: [...message.parts],
  }

  switch (delta.type) {
    case 'part_add':
      next.parts[delta.partIndex] = cloneValue(delta.part)
      break
    case 'tool_input_set':
      updateToolPart(next.parts, delta.partIndex, (part) => {
        part.state = 'input-available'
      })
      break
    case 'tool_output_set':
      updateToolPart(next.parts, delta.partIndex, (part) => {
        part.state = delta.state
      })
      break
    case 'tool_arguments_append':
      break
  }

  return next
}

function updateToolPart(parts: MessagePart[], index: number, update: (part: DynamicToolPart) => void): void {
  const part = parts[index]
  if (!part || part.type !== 'dynamic-tool') {
    return
  }
  update(part)
}

function readToolAnchor(message: SimulatedMessage, partIndex: number): DynamicToolPart | null {
  const part = message.parts[partIndex]
  if (!part || part.type !== 'dynamic-tool') {
    return null
  }
  return part
}

function applyToolDelta(
  entities: Map<string, ToolEntity>,
  messageId: string,
  message: SimulatedMessage,
  delta: ChatPartDelta,
): Map<string, ToolEntity> {
  const next = new Map(entities)
  if (delta.type === 'part_add' && delta.part.type === 'dynamic-tool') {
    next.set(delta.part.toolCallId, {
      messageId,
      toolCallId: delta.part.toolCallId,
      toolName: delta.part.toolName,
      state: delta.part.state,
      argumentsText: '',
    })
    return next
  }

  const anchor = readToolAnchor(message, delta.partIndex)
  if (!anchor) {
    return next
  }

  const current = next.get(anchor.toolCallId) ?? {
    messageId,
    toolCallId: anchor.toolCallId,
    toolName: anchor.toolName,
    state: anchor.state,
    argumentsText: '',
  }

  switch (delta.type) {
    case 'tool_arguments_append':
      next.set(anchor.toolCallId, {
        ...current,
        state: anchor.state,
        argumentsText: `${current.argumentsText ?? ''}${delta.text}`,
      })
      break
    case 'tool_input_set':
      next.set(anchor.toolCallId, {
        ...current,
        state: 'input-available',
        input: delta.input,
      })
      break
    case 'tool_output_set':
      next.set(anchor.toolCallId, {
        ...current,
        state: delta.state,
        output: delta.output,
        errorText: delta.errorText,
      })
      break
    default:
      break
  }

  return next
}

function applyEvents(limit: number): { message: SimulatedMessage, toolEntities: Map<string, ToolEntity> } {
  let message = INITIAL_MESSAGE
  let toolEntities = new Map<string, ToolEntity>()

  for (const event of STREAM_EVENTS.slice(0, limit)) {
    message = applyDelta(message, event.delta)
    toolEntities = applyToolDelta(toolEntities, INITIAL_MESSAGE.id, message, event.delta)
  }

  return { message, toolEntities }
}

function readToolInputPayload(tool: ToolEntity): ToolPayload {
  if (tool.input !== undefined) {
    return parsePayloadObject(tool.input, null)
  }

  const rawArguments = tool.argumentsText ?? ''
  return parsePayloadObject(parsePartialJsonObject(rawArguments), rawArguments)
}

function parsePayloadObject(value: unknown, rawText: string | null): ToolPayload {
  if (typeof value === 'string') {
    return {
      ...emptyPayload(),
      rawText: value,
    }
  }

  if (!isRecord(value)) {
    return {
      ...emptyPayload(),
      rawText,
    }
  }

  const file = isRecord(value.file)
    ? {
        filePath: readString(value.file.filePath),
        content: readString(value.file.content),
        type: readString(value.file.type),
      }
    : null

  return {
    rawText,
    filePath: readString(value.file_path) ?? readString(value.filePath) ?? readString(value.path) ?? file?.filePath ?? readString(value.filename),
    command: readString(value.command) ?? readString(value.cmd),
    oldString: readString(value.old_string) ?? readString(value.oldString),
    newString: readString(value.new_string) ?? readString(value.newString),
    contentText: readString(value.content),
    outputText: readString(value.output) ?? readString(value.result),
    file,
  }
}

function parsePartialJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed || !trimmed.startsWith('{')) {
    return {}
  }

  try {
    const parsed = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : {}
  }
  catch {
    return readTopLevelObjectPrefix(trimmed)
  }
}

function readTopLevelObjectPrefix(text: string): Record<string, unknown> {
  const object: Record<string, unknown> = {}
  let index = 1

  while (index < text.length) {
    index = skipSeparators(text, index)
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
    index = skipWhitespace(text, key.next)
    if (text[index] !== ':') {
      break
    }
    index = skipWhitespace(text, index + 1)

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

function skipSeparators(text: string, index: number): number {
  let nextIndex = skipWhitespace(text, index)
  while (text[nextIndex] === ',') {
    nextIndex = skipWhitespace(text, nextIndex + 1)
  }
  return nextIndex
}

function skipWhitespace(text: string, index: number): number {
  let nextIndex = index
  while (/\s/.test(text[nextIndex] ?? '')) {
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

  const tokenEnd = readPrimitiveEnd(text, start)
  const token = text.slice(start, tokenEnd).trim()
  if (!token) {
    return { value: undefined, next: tokenEnd, complete: false, read: false }
  }

  if (token === 'true' || token === 'false' || token === 'null' || /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(token)) {
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

function emptyPayload(): ToolPayload {
  return {
    rawText: null,
    filePath: null,
    command: null,
    oldString: null,
    newString: null,
    contentText: null,
    outputText: null,
    file: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getToolParts(message: SimulatedMessage, toolEntities: Map<string, ToolEntity>): ToolEntity[] {
  return message.parts.flatMap((part) => {
    if (part.type !== 'dynamic-tool') {
      return []
    }
    const entity = toolEntities.get(part.toolCallId)
    return entity ? [entity] : []
  })
}

function readPreviewState(tool: ToolEntity): { target: string, preview: string, payloadSize: string } {
  const input = readToolInputPayload(tool)
  const output = parsePayloadObject(tool.output, typeof tool.output === 'string' ? tool.output : null)
  const rawPayloadSize = tool.argumentsText?.length ?? 0
  const liveContentSize = input.contentText?.length ?? input.oldString?.length ?? input.newString?.length ?? 0
  const target = input.filePath ?? output.filePath ?? input.command ?? 'pending'

  if (tool.toolName === 'Read') {
    return {
      target,
      preview: output.rawText || output.file ? 'result preview available' : target === 'pending' ? 'waiting for arguments' : 'target parsed before output',
      payloadSize: `${rawPayloadSize} chars`,
    }
  }

  return {
    target,
    preview: liveContentSize > 0 ? `live payload: ${liveContentSize} chars` : 'waiting for streamed content',
    payloadSize: `${rawPayloadSize} chars`,
  }
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function classNameForEvent(index: number, currentStep: number): string {
  if (index + 1 === currentStep) {
    return 'rounded-md border border-accent bg-accent/10 px-3 py-2 text-left text-foreground transition-colors'
  }
  if (index + 1 < currentStep) {
    return 'rounded-md border border-border bg-card px-3 py-2 text-left text-muted-foreground transition-colors'
  }
  return 'rounded-md border border-border bg-background px-3 py-2 text-left text-muted-foreground/70 transition-colors'
}

function DeltaTimeline({
  currentStep,
  onStepChange,
}: {
  currentStep: number
  onStepChange: (step: number) => void
}) {
  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => onStepChange(0)}
        className="rounded-md border border-border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
      >
        Reset stream
      </button>
      {STREAM_EVENTS.map((event, index) => (
        <button
          key={`${event.delta.seq}-${event.label}`}
          type="button"
          onClick={() => onStepChange(index + 1)}
          className={classNameForEvent(index, currentStep)}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium">{event.label}</span>
            <span className="font-mono text-[10px]">
seq
{event.delta.seq}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed opacity-80">{event.note}</p>
        </button>
      ))}
    </div>
  )
}

function ToolPartCard({ tool }: { tool: ToolEntity }) {
  const input = readToolInputPayload(tool)
  const preview = readPreviewState(tool)

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{tool.toolName}</h3>
          <p className="font-mono text-[11px] text-muted-foreground">{tool.toolCallId}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground">
          {tool.state}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <MetricPanel label="target" value={preview.target} />
        <MetricPanel label="preview" value={preview.preview} />
        <MetricPanel label="argumentsText" value={preview.payloadSize} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-background p-3">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">Live parsed arguments</div>
          <dl className="mt-2 grid gap-1 text-xs">
            <KeyValue label="filePath" value={input.filePath} />
            <KeyValue label="command" value={input.command} />
            <KeyValue label="oldString" value={input.oldString ? `${input.oldString.length} chars` : null} />
            <KeyValue label="newString" value={input.newString ? `${input.newString.length} chars` : null} />
            <KeyValue label="content" value={input.contentText ? `${input.contentText.length} chars` : null} />
          </dl>
        </div>

        <div className="rounded-md border border-border bg-background p-3">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">Committed input</div>
          <dl className="mt-2 grid gap-1 text-xs">
            <KeyValue label="available" value={tool.input === undefined ? 'no' : 'yes'} />
            <KeyValue label="state" value={tool.state} />
            <KeyValue label="output" value={tool.output === undefined ? null : 'available'} />
          </dl>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <CodePanel title="toolEntity.argumentsText" value={tool.argumentsText ?? ''} />
        <CodePanel title="toolEntity.input" value={tool.input ?? null} />
      </div>
    </section>
  )
}

function MetricPanel({ label, value }: { label: string, value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-background p-3">
      <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 truncate font-mono text-xs text-foreground" title={value}>{value}</div>
    </div>
  )
}

function KeyValue({ label, value }: { label: string, value: string | null }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-mono text-foreground" title={value ?? ''}>
        {value ?? 'null'}
      </dd>
    </div>
  )
}

function CodePanel({ title, value }: { title: string, value: unknown }) {
  const text = typeof value === 'string' ? value : formatJson(value)
  return (
    <div className="min-w-0 rounded-md border border-border bg-background">
      <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
        {title}
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-foreground">
        {text || '""'}
      </pre>
    </div>
  )
}

function DeltaInspector({ event }: { event: SimulatedEvent | null }) {
  if (!event) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Select a stream event to inspect the delta payload.
      </div>
    )
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{event.label}</h3>
          <p className="text-xs text-muted-foreground">{event.note}</p>
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">
seq
{event.delta.seq}
        </span>
      </div>
      <div className="mt-3">
        <CodePanel title="delta" value={event.delta} />
      </div>
    </section>
  )
}

export function ToolCallStreamPage() {
  const [currentStep, setCurrentStep] = useState(0)
  const simulation = useMemo(() => applyEvents(currentStep), [currentStep])
  const currentEvent = currentStep === 0 ? null : STREAM_EVENTS[currentStep - 1]
  const toolParts = getToolParts(simulation.message, simulation.toolEntities)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-foreground">Tool Call Argument Stream</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              This page replays the new event-driven model: part_add creates a lightweight message anchor, tool_arguments_append patches a store-owned tool entity, and tool_input_set commits structured input later.
            </p>
          </div>
          <div className="rounded-md bg-muted px-3 py-2 text-right">
            <div className="font-mono text-xs text-foreground">
{currentStep}
/
{STREAM_EVENTS.length}
            </div>
            <div className="text-[10px] uppercase text-muted-foreground">events applied</div>
          </div>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] overflow-hidden">
        <aside className="min-h-0 overflow-y-auto border-r border-border p-4">
          <DeltaTimeline currentStep={currentStep} onStepChange={setCurrentStep} />
        </aside>

        <section className="min-h-0 overflow-y-auto p-6">
          <div className="grid gap-4">
            <DeltaInspector event={currentEvent} />

            {toolParts.length === 0 && (
              <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
                No tool anchor has been added yet.
              </div>
            )}

            {toolParts.map(tool => (
              <ToolPartCard key={tool.toolCallId} tool={tool} />
            ))}

            <CodePanel title="message.parts" value={simulation.message.parts} />
            <CodePanel title="toolEntities" value={Object.fromEntries(simulation.toolEntities)} />
          </div>
        </section>
      </main>
    </div>
  )
}
