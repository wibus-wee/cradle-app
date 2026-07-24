import { FileLine as FilePenLineIcon, FileLine as FileTextIcon } from '@mingcute/react'
import type { ReactNode } from 'react'

import { Progress } from '~/components/ui/progress'
import { Table, TableBody, TableCell, TableRow } from '~/components/ui/table'
import { cn } from '~/lib/cn'

import { EditFileBlock } from '../../rendering/blocks/edit-file-block'
import { readTerminalOutputSections } from '../../rendering/terminal-tool-details'
import type { ToolPayload, ToolState } from '../../rendering/tool-ui-classifier'
import { readToolInputPayload, readToolPayload } from '../../rendering/tool-ui-classifier'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_TEXT_CLASS = 'font-mono text-[11px] leading-relaxed text-muted-foreground'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value === null || value === undefined) {
    return ''
  }
  return JSON.stringify(value, null, 2)
}

function formatCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

function isRunning(state: ToolState): boolean {
  return (
    state === 'input-streaming' || state === 'input-available' || state === 'approval-requested'
  )
}

function readStreamingInputText(input: ToolPayload): string | null {
  return input.rawText ?? input.inputText
}

function readEditTarget(input: ToolPayload, output: ToolPayload): string | null {
  return input.filePath ?? output.filePath ?? input.filenames[0] ?? output.filenames[0] ?? null
}

function readEditPayloadSize(input: ToolPayload): number {
  const streamingText = readStreamingInputText(input)
  if (streamingText) {
    return streamingText.length
  }
  const parts = [input.oldString, input.newString, input.contentText].filter(
    (value): value is string => value !== null,
  )
  return parts.reduce((total, value) => total + value.length, 0)
}

function readReplaceAll(input: ToolPayload, output: ToolPayload): boolean {
  return input.replaceAll === true || output.replaceAll === true
}

function applyEditPreview(
  originalFile: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  if (!oldString || !originalFile.includes(oldString)) {
    return newString
  }
  return replaceAll
    ? originalFile.split(oldString).join(newString)
    : originalFile.replace(oldString, newString)
}

interface EditDiffPreview {
  filePath: string
  oldContent: string
  newContent: string
}

// ---------------------------------------------------------------------------
// Exported helpers (consumed by grouped-tool-call-block and tool-call-block)
// ---------------------------------------------------------------------------

export function readEditDiffPreview(
  input: ToolPayload,
  output: ToolPayload,
): EditDiffPreview | null {
  const filePath = input.filePath ?? output.filePath
  if (!filePath) {
    return null
  }

  const oldString = input.oldString ?? output.oldString
  const newString = input.newString ?? output.newString
  const originalFile = output.originalFile
  const writtenContent = input.contentText ?? output.contentText

  if (originalFile && oldString && newString) {
    return {
      filePath,
      oldContent: originalFile,
      newContent: applyEditPreview(
        originalFile,
        oldString,
        newString,
        readReplaceAll(input, output),
      ),
    }
  }

  if (originalFile && writtenContent) {
    return {
      filePath,
      oldContent: originalFile,
      newContent: writtenContent,
    }
  }

  if (oldString && newString) {
    return {
      filePath,
      oldContent: oldString,
      newContent: newString,
    }
  }

  return null
}

export function hasFileDiffPayloadContent(input: ToolPayload, output: ToolPayload): boolean {
  return (
    readEditDiffPreview(input, output) !== null
    || readEditTarget(input, output) !== null
    || readEditPayloadSize(input) > 0
    || output.gitDiff.patch.length > 0
    || output.structuredPatch.length > 0
  )
}

export function hasFileDiffInlineContent(input: ToolPayload, output: ToolPayload): boolean {
  return (
    readEditDiffPreview(input, output) !== null
    || readEditPayloadSize(input) > 0
    || output.gitDiff.patch.length > 0
    || output.structuredPatch.length > 0
  )
}

export function readFileDiffPayload(
  input: unknown,
  output: unknown,
  argumentsText?: string,
): { input: ToolPayload, output: ToolPayload } {
  const inputPayload = readToolInputPayload(input, argumentsText)
  const outputPayload = readToolPayload(output)
  return { input: inputPayload, output: outputPayload }
}

export function readFileDiffTarget(
  input: unknown,
  output: unknown,
  argumentsText?: string,
): string | null {
  const payload = readFileDiffPayload(input, output, argumentsText)
  return readEditTarget(payload.input, payload.output)
}

export function hasFileDiffDetails(
  input: unknown,
  output: unknown,
  argumentsText?: string,
  errorText?: string,
): boolean {
  const payload = readFileDiffPayload(input, output, argumentsText)
  return hasDiffPreviewContent(payload.input, payload.output, errorText)
}

function hasDiffPreviewContent(
  input: ToolPayload,
  output: ToolPayload,
  errorText?: string,
): boolean {
  return !!errorText || hasFileDiffPayloadContent(input, output)
}

export function hasDiffHeroContent(input: ToolPayload, output: ToolPayload): boolean {
  return hasFileDiffPayloadContent(input, output)
}

// ---------------------------------------------------------------------------
// Shared UI components
// ---------------------------------------------------------------------------

export function RawValue({ value, className }: { value: unknown, className?: string }) {
  const text = formatValue(value)
  if (!text) {
    return null
  }
  return <NativeCodeBlock text={text} className={className} />
}

export function NativeCodeBlock({
  text,
  destructive = false,
  wrap = true,
  className,
}: {
  text: string
  destructive?: boolean
  wrap?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'max-h-56 overflow-auto overscroll-contain rounded-md bg-muted/35',
        destructive && 'bg-destructive/5',
        className,
      )}
      onClick={event => event.stopPropagation()}
    >
      <pre
        className={cn(
          CODE_TEXT_CLASS,
          wrap ? 'whitespace-pre-wrap break-words' : 'min-w-max whitespace-pre',
          'p-2.5',
          destructive && 'text-destructive/80',
        )}
      >
        {text}
      </pre>
    </div>
  )
}

export function KeyValueTable({ rows }: { rows: Array<[string, ReactNode]> }) {
  const visibleRows = rows.filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  )
  if (visibleRows.length === 0) {
    return null
  }
  return (
    <Table className="text-xs">
      <TableBody>
        {visibleRows.map(([label, value]) => (
          <TableRow key={label} className="border-border/50 hover:bg-transparent">
            <TableCell className="w-28 py-1.5 pr-3 align-top font-medium text-muted-foreground">
              {label}
            </TableCell>
            <TableCell className="min-w-0 py-1.5 whitespace-normal text-foreground/85">
              {value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function PathList({
  paths,
  emptyText = 'No paths returned',
}: {
  paths: string[]
  emptyText?: string
}) {
  if (paths.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>
  }
  return (
    <div className="grid gap-1">
      {paths.slice(0, 24).map(path => (
        <div
          key={path}
          className="flex min-w-0 items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5"
        >
          <FileTextIcon className="size-3.5 shrink-0 !text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate font-mono text-[11px] text-foreground/80" title={path}>
            {path}
          </span>
        </div>
      ))}
      {paths.length > 24 && (
        <p className="px-2 text-xs text-muted-foreground">
          {formatCount(paths.length - 24, 'more path')}
        </p>
      )}
    </div>
  )
}

export function DetailSection({ title, children }: { title: string, children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <div className="text-[10px] font-medium uppercase text-muted-foreground">{title}</div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Execution details components
// ---------------------------------------------------------------------------

export function TerminalExecutionDetails({
  input,
  output,
  errorText,
  argumentsText,
  className,
}: {
  input: unknown
  output: unknown
  errorText?: string
  argumentsText?: string
  className?: string
}) {
  const inputPayload = readToolInputPayload(input, argumentsText)
  const outputPayload = readToolPayload(output)
  const sections = readTerminalOutputSections(outputPayload, errorText)
  const command = inputPayload.command
  const timeout = inputPayload.timeout
  const backgroundTaskId = outputPayload.backgroundTaskId

  if (!command && timeout === null && !backgroundTaskId && sections.length === 0) {
    return null
  }

  return (
    <div className={cn('grid gap-3', className)}>
      {(command || timeout !== null || backgroundTaskId) && (
        <DetailSection title="Command">
          <div className="grid gap-1.5">
            {command && <NativeCodeBlock text={command} wrap={false} className="max-h-32" />}
            <KeyValueTable
              rows={[
                ['Timeout', timeout],
                ['Background', backgroundTaskId],
              ]}
            />
          </div>
        </DetailSection>
      )}
      {sections.length > 0 && (
        <DetailSection title="Output">
          <div className="grid gap-2">
            {sections.map(section => (
              <section key={section.label} className="grid gap-1">
                {sections.length > 1 && (
                  <div
                    className={cn(
                      'px-0.5 font-mono text-[10px] font-medium',
                      section.destructive ? 'text-destructive/70' : 'text-muted-foreground/60',
                    )}
                  >
                    {section.label}
                  </div>
                )}
                <NativeCodeBlock
                  text={section.text}
                  destructive={section.destructive}
                  wrap={false}
                  className="max-h-44"
                />
              </section>
            ))}
          </div>
        </DetailSection>
      )}
    </div>
  )
}

export function FileDiffExecutionDetails({
  input,
  output,
  errorText,
  argumentsText,
  state,
  className,
}: {
  input: unknown
  output: unknown
  errorText?: string
  argumentsText?: string
  state: ToolState
  className?: string
}) {
  const inputPayload = readToolInputPayload(input, argumentsText)
  const outputPayload = readToolPayload(output)

  return (
    <div className={cn('grid gap-2', className)}>
      {errorText && (
        <DetailSection title="Error">
          <RawValue value={errorText} className="max-h-40 bg-destructive/5" />
        </DetailSection>
      )}
      {hasFileDiffPayloadContent(inputPayload, outputPayload) && (
        <DiffSummary
          input={inputPayload}
          output={outputPayload}
          state={state}
          presentation="detail"
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Diff summary (shared by FileDiffExecutionDetails and ToolHero)
// ---------------------------------------------------------------------------

export function DiffSummary({
  input,
  output,
  state,
  defaultOpen = false,
  presentation = 'preview',
}: {
  input: ToolPayload
  output: ToolPayload
  state: ToolState
  defaultOpen?: boolean
  presentation?: 'preview' | 'detail'
}) {
  const editPreview = readEditDiffPreview(input, output)
  if (editPreview) {
    return (
      <EditFileBlock
        filePath={editPreview.filePath}
        oldContent={editPreview.oldContent}
        newContent={editPreview.newContent}
        presentation={presentation}
        defaultOpen={defaultOpen}
      />
    )
  }

  const filePath = readEditTarget(input, output)
  const payloadSize = readEditPayloadSize(input)
  if (filePath || payloadSize > 0) {
    return (
      <div
        className="grid gap-2 rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground"
        data-testid="chat-edit-file-streaming-preview"
      >
        <div className="flex min-w-0 items-center gap-2">
          <FilePenLineIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden />
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/75"
            title={filePath ?? undefined}
          >
            {filePath ?? 'Receiving file edit'}
          </span>
          {payloadSize > 0 && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/60">
              {formatCount(payloadSize, 'char')}
            </span>
          )}
        </div>
        {isRunning(state) && <Progress value={65} className="h-1" />}
      </div>
    )
  }

  const patch = output.gitDiff.patch
  if (patch) {
    return <RawValue value={patch} className="max-h-64" />
  }
  if (output.structuredPatch.length > 0) {
    const lines = output.structuredPatch.flatMap(hunk => hunk.lines)
    return <RawValue value={lines.join('\n')} className="max-h-64" />
  }
  return (
    <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
      File change prepared.
    </p>
  )
}
