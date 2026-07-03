import type { TableUserConfig } from 'table'
import { getBorderCharacters, table } from 'table'
import { z } from 'zod'

import type { CliOutputFormat } from './types'

export interface PrintResultOptions {
  format: CliOutputFormat
  jsonFields?: string[]
  forceJson?: boolean
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema)
  ])
)

const ScalarCellSchema = z.union([
  z.string().transform((value) => ({ text: value, scalar: true, textValue: value })),
  z.number().transform((value) => ({ text: JSON.stringify(value), scalar: true, textValue: null })),
  z
    .boolean()
    .transform((value) => ({ text: JSON.stringify(value), scalar: true, textValue: null })),
  z.null().transform(() => ({ text: '', scalar: true, textValue: null }))
])

const CellProjectionSchema = z.union([
  ScalarCellSchema,
  z.undefined().transform(() => ({ text: '', scalar: false, textValue: null })),
  JsonValueSchema.transform((value) => ({
    text: JSON.stringify(value),
    scalar: false,
    textValue: null
  }))
])

const CliRecordSchema = z.record(z.string(), JsonValueSchema)

const RecordProjectionSchema = CliRecordSchema.transform((record) => {
  const cells = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, CellProjectionSchema.parse(value)])
  )
  const scalarKeys = Object.entries(cells)
    .filter(([, cell]) => cell.scalar)
    .map(([key]) => key)
  const preferredText =
    ['markdown', 'content', 'text', 'output', 'message']
      .map((key) => cells[key]?.textValue ?? null)
      .find((text) => text !== null) ?? null
  const entries = Object.entries(cells)
  const singleText = entries.length === 1 ? entries[0][1].textValue : null

  return {
    raw: record,
    cells,
    scalarKeys,
    textValue: preferredText ?? singleText,
    keyValueRows: scalarKeys.map((key) => [key, cells[key].text] as const),
    okOnly: record.ok === true && Object.keys(record).length === 1
  }
})

const ResultItemProjectionSchema = z.union([
  RecordProjectionSchema.transform((record) => ({
    kind: 'record' as const,
    raw: record.raw,
    record
  })),
  JsonValueSchema.transform((value) => ({ kind: 'value' as const, raw: value }))
])

const ResultProjectionSchema = z.union([
  z
    .array(ResultItemProjectionSchema)
    .transform((items) => ({ kind: 'array' as const, raw: items.map((item) => item.raw), items })),
  RecordProjectionSchema.transform((record) => ({
    kind: 'record' as const,
    raw: record.raw,
    record
  })),
  z.string().transform((value) => ({ kind: 'string' as const, raw: value, value })),
  JsonValueSchema.transform((value) => ({ kind: 'value' as const, raw: value }))
])

type ResultProjection = z.infer<typeof ResultProjectionSchema>
type ResultItemProjection = z.infer<typeof ResultItemProjectionSchema>
type JsonRecord = Record<string, unknown>

interface AgentSearchResult {
  id: string
  kind: string
  title: string | null
  metadata: Array<readonly [string, string]>
  preview: string | null
  next: string | null
}

function getDisplayWidth(value: string): number {
  return value.length
}

function getTableWidthLimit(): number {
  return Math.max(80, Math.min(process.stdout.columns || 120, 160))
}

function getColumnWidths(rows: string[][]): Record<number, { truncate: number; width: number }> {
  const columnCount = rows[0]?.length ?? 0
  if (columnCount === 0) {
    return {}
  }

  const paddingWidth = columnCount * 2
  const borderWidth = columnCount + 1
  const availableWidth = Math.max(
    columnCount * 8,
    getTableWidthLimit() - paddingWidth - borderWidth
  )
  const measuredWidths = Array.from({ length: columnCount }, (_, index) => {
    return Math.max(...rows.map((row) => getDisplayWidth(row[index] ?? '')))
  })
  const maximumWidths = measuredWidths.map((width) => Math.min(56, width))
  const minimumWidths = measuredWidths.map((width) => Math.min(width, 12))
  const minimumTotal = minimumWidths.reduce((sum, width) => sum + width, 0)
  const maximumTotal = maximumWidths.reduce((sum, width) => sum + width, 0)

  if (maximumTotal <= availableWidth) {
    return Object.fromEntries(
      maximumWidths.map((width, index) => [index, { truncate: width, width }])
    )
  }

  const flexibleTotal = maximumWidths.reduce((sum, width, index) => {
    return sum + Math.max(0, width - minimumWidths[index])
  }, 0)
  const remainingWidth = Math.max(0, availableWidth - minimumTotal)

  return Object.fromEntries(
    Array.from({ length: columnCount }, (_, index) => {
      const flexibleWidth = Math.max(0, maximumWidths[index] - minimumWidths[index])
      const extraWidth =
        flexibleTotal === 0 ? 0 : Math.floor((flexibleWidth / flexibleTotal) * remainingWidth)
      const width = Math.max(8, Math.min(maximumWidths[index], minimumWidths[index] + extraWidth))
      return [index, { truncate: width, width }]
    })
  )
}

function printTable(rows: ResultItemProjection[], columns: string[]): void {
  if (rows.length === 0) {
    console.log('No results')
    return
  }

  const tableRows = [
    columns,
    ...rows.map((row) =>
      columns.map((column) => (row.kind === 'record' ? (row.record.cells[column]?.text ?? '') : ''))
    )
  ]
  const config = {
    border: getBorderCharacters('norc'),
    columnDefault: {
      paddingLeft: 1,
      paddingRight: 1,
      wrapWord: false
    },
    columns: getColumnWidths(tableRows),
    drawHorizontalLine: (index: number) => index === 0 || index === 1 || index === tableRows.length
  } satisfies TableUserConfig

  console.log(table(tableRows, config).trimEnd())
}

function getTableColumns(rows: ResultItemProjection[]): string[] {
  const columns = new Set<string>()
  for (const row of rows) {
    if (row.kind === 'record') {
      for (const key of row.record.scalarKeys) {
        columns.add(key)
      }
    }
  }
  return Array.from(columns)
}

function printNdjson(result: ResultProjection): void {
  if (result.kind === 'array') {
    for (const item of result.raw) {
      console.log(JSON.stringify(item))
    }
    return
  }
  console.log(JSON.stringify(result.raw))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(record: JsonRecord, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readRecord(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key]
  return isRecord(value) ? value : null
}

function readRecordArray(record: JsonRecord, key: string): JsonRecord[] {
  const value = record[key]
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripMarkTags(value: string): string {
  return value.replace(/<\/?mark>/g, '')
}

function formatPreview(value: string): string {
  return normalizeWhitespace(stripMarkTags(value))
}

function formatAgentResult(result: AgentSearchResult, index: number): string {
  const lines = [`Result ${index + 1}`]
  lines.push(`kind: ${result.kind}`)
  lines.push(`id: ${result.id}`)
  if (result.title) {
    lines.push(`title: ${result.title}`)
  }
  for (const [key, value] of result.metadata) {
    lines.push(`${key}: ${value}`)
  }
  if (result.preview) {
    lines.push('preview:')
    lines.push(result.preview)
  }
  if (result.next) {
    lines.push('next:')
    lines.push(result.next)
  }
  return lines.join('\n')
}

function projectThreadSearchHit(record: JsonRecord): AgentSearchResult | null {
  const sessionId = readString(record, 'sessionId')
  const snippets = readRecordArray(record, 'snippets')
  if (!sessionId || snippets.length === 0) {
    return null
  }

  const firstSnippet = snippets[0]
  const messageRole = readString(firstSnippet, 'messageRole')
  const preview = readString(firstSnippet, 'text')
  const metadata: Array<readonly [string, string]> = []
  const workspaceName = readString(record, 'workspaceName')
  const matchCount = readNumber(record, 'matchCount')
  if (workspaceName) {
    metadata.push(['workspace', workspaceName])
  }
  if (messageRole) {
    metadata.push(['messageRole', messageRole])
  }
  if (matchCount !== null) {
    metadata.push(['matches', String(matchCount)])
  }

  return {
    id: sessionId,
    kind: 'thread',
    metadata,
    next: `cradle chat messages ${sessionId}`,
    preview: preview ? formatPreview(preview) : null,
    title: readString(record, 'sessionTitle')
  }
}

function projectChronicleSearchHit(record: JsonRecord): AgentSearchResult | null {
  const id = readString(record, 'id')
  const type = readString(record, 'type')
  const snippet = readRecord(record, 'snippet')
  if (!id || !type || !snippet) {
    return null
  }

  const metadata: Array<readonly [string, string]> = []
  const workspaceName = readString(record, 'workspaceName')
  const matchCount = readNumber(record, 'matchCount')
  const memoryType = readString(record, 'memoryType')
  const cardType = readString(record, 'cardType')
  const dimension = readString(record, 'dimension')
  if (workspaceName) {
    metadata.push(['workspace', workspaceName])
  }
  if (memoryType) {
    metadata.push(['memoryType', memoryType])
  }
  if (cardType) {
    metadata.push(['cardType', cardType])
  }
  if (dimension) {
    metadata.push(['dimension', dimension])
  }
  if (matchCount !== null) {
    metadata.push(['matches', String(matchCount)])
  }

  const preview = readString(snippet, 'text')

  return {
    id,
    kind: `chronicle-${type}`,
    metadata,
    next:
      type === 'memory'
        ? `cradle chronicle memories get ${id}`
        : `cradle chronicle knowledge-cards get ${id}`,
    preview: preview ? formatPreview(preview) : null,
    title: readString(record, 'title')
  }
}

function projectIssueSearchHit(record: JsonRecord): AgentSearchResult | null {
  const id = readString(record, 'id')
  const title = readString(record, 'title')
  const number = readNumber(record, 'number')
  if (!id || !title || number === null) {
    return null
  }

  const metadata: Array<readonly [string, string]> = []
  const priority = readString(record, 'priority')
  const statusId = readString(record, 'statusId')
  const workspaceId = readString(record, 'workspaceId')
  if (workspaceId) {
    metadata.push(['workspaceId', workspaceId])
  }
  if (priority) {
    metadata.push(['priority', priority])
  }
  if (statusId) {
    metadata.push(['statusId', statusId])
  }

  const description = readString(record, 'description')

  return {
    id,
    kind: 'issue',
    metadata,
    next: `cradle issue get ${id}`,
    preview: description ? formatPreview(description).slice(0, 260) : null,
    title: `#${number} ${title}`
  }
}

function projectAgentSearchResult(value: unknown): AgentSearchResult | null {
  if (!isRecord(value)) {
    return null
  }
  return (
    projectThreadSearchHit(value) ??
    projectChronicleSearchHit(value) ??
    projectIssueSearchHit(value)
  )
}

function isAgentSearchResult(value: AgentSearchResult | null): value is AgentSearchResult {
  return value !== null
}

function printAgent(result: unknown): boolean {
  if (!Array.isArray(result)) {
    return false
  }

  if (result.length === 0) {
    console.log('No results')
    return true
  }

  const projected = result.map(projectAgentSearchResult)
  if (!projected.every(isAgentSearchResult)) {
    return false
  }

  console.log(projected.map((item, index) => formatAgentResult(item, index)).join('\n\n'))
  return true
}

function countExistingFields(record: Record<string, unknown>, fields: string[]): number {
  return fields.filter((field) => Object.hasOwn(record, field)).length
}

function selectFieldsFromRecord(
  record: Record<string, unknown>,
  fields: string[]
): Record<string, unknown> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      return Object.hasOwn(record, field) ? [[field, record[field]]] : []
    })
  )
}

function selectFieldsFromArray(items: unknown[], fields: string[]): unknown[] {
  return items.map((item) => (isRecord(item) ? selectFieldsFromRecord(item, fields) : item))
}

function findWrappedArrayForFields(
  record: Record<string, unknown>,
  fields: string[]
): unknown[] | null {
  const directScore = countExistingFields(record, fields)
  const candidates = Object.values(record).flatMap((value) => {
    if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
      return []
    }
    const score = value.reduce((highestScore, item) => {
      return Math.max(highestScore, countExistingFields(item, fields))
    }, 0)
    return [{ score, value }]
  })

  if (candidates.length === 0) {
    return null
  }

  const ranked = candidates.slice().sort((a, b) => b.score - a.score)
  const best = ranked[0]
  const second = ranked[1]
  if (best.value.length === 0 && directScore === 0 && candidates.length === 1) {
    return best.value
  }
  if (best.score > directScore && best.score > 0 && (!second || second.score < best.score)) {
    return best.value
  }

  return null
}

function selectJsonFields(result: unknown, fields: string[] | undefined): unknown {
  if (!fields || fields.length === 0) {
    return result
  }

  if (Array.isArray(result)) {
    return selectFieldsFromArray(result, fields)
  }

  if (isRecord(result)) {
    const wrappedArray = findWrappedArrayForFields(result, fields)
    if (wrappedArray) {
      return selectFieldsFromArray(wrappedArray, fields)
    }
    return selectFieldsFromRecord(result, fields)
  }

  return result
}

function printKeyValue(rows: Array<readonly [string, string]>): boolean {
  if (rows.length === 0) {
    return false
  }

  const width = Math.max(...rows.map(([key]) => key.length))
  for (const [key, value] of rows) {
    console.log(`${key.padEnd(width)}  ${value}`)
  }
  return true
}

function printAuto(result: ResultProjection): void {
  if (result.kind === 'array') {
    if (printAgent(result.raw)) {
      return
    }

    const columns = getTableColumns(result.items)
    if (columns.length > 0 || result.items.length === 0) {
      printTable(result.items, columns)
      return
    }
    console.log(JSON.stringify(result.raw, null, 2))
    return
  }

  if (result.kind === 'record') {
    if (result.record.okOnly) {
      console.log('ok')
      return
    }

    if (result.record.textValue !== null) {
      console.log(result.record.textValue)
      return
    }

    if (printKeyValue(result.record.keyValueRows)) {
      return
    }
  }

  if (result.kind === 'string') {
    console.log(result.value)
    return
  }

  console.log(JSON.stringify(result.raw, null, 2))
}

export function printResult(result: unknown, options: PrintResultOptions): void {
  const selectedResult = selectJsonFields(result, options.jsonFields)
  const projection = ResultProjectionSchema.parse(selectedResult)

  if (options.forceJson) {
    console.log(JSON.stringify(selectedResult, null, 2))
    return
  }

  const format = options.format

  if (format === 'json') {
    console.log(JSON.stringify(selectedResult))
    return
  }

  if (format === 'pretty') {
    console.log(JSON.stringify(selectedResult, null, 2))
    return
  }

  if (format === 'ndjson') {
    printNdjson(projection)
    return
  }

  if (format === 'agent') {
    if (printAgent(selectedResult)) {
      return
    }
    console.log(JSON.stringify(selectedResult, null, 2))
    return
  }

  if (format === 'table' && projection.kind === 'array') {
    const columns = getTableColumns(projection.items)
    if (columns.length > 0 || projection.items.length === 0) {
      printTable(projection.items, columns)
      return
    }
  }

  if (format === 'auto') {
    printAuto(projection)
    return
  }

  console.log(JSON.stringify(selectedResult, null, 2))
}
