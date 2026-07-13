/**
 * Output: Codex stream diagnostics, notification helpers, and provider stream errors.
 * Input: Codex app-server notifications and bounded diagnostic samples.
 * Position: Codex provider package owner for stream failure reporting.
 */

import type { RuntimeWarningPartData } from '../../../chat-runtime/runtime-provider-types'
import { OBSERVABILITY_CODES } from '../../../observability/contract'
import type { RuntimeKind } from '../../../provider-contracts/types'
import type { CodexAppServerMessage } from '../app-server/client'
import { CODEX_RUNTIME_KIND } from '../metadata'

const MAX_EVENT_SAMPLES = 20
const MAX_DIAGNOSTIC_STRING_LENGTH = 2_000
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 20
const MAX_DIAGNOSTIC_OBJECT_KEYS = 40
const MAX_DIAGNOSTIC_DEPTH = 4

export interface CodexStreamDiagnostics {
  totalEvents: number
  mappedEvents: number
  completedTurnEvents: number
  retryableErrorEvents: number
  eventTypeCounts: Record<string, number>
  itemTypeCounts: Record<string, number>
  sampleEvents: Array<Record<string, unknown>>
  errorEvents: Array<Record<string, unknown>>
}

export interface CodexProviderErrorData {
  details?: string | null
  runtimeKind?: RuntimeKind
  diagnostics?: CodexStreamDiagnostics
  notification?: Record<string, unknown>
  threadId?: string
  command?: string
  timeoutMs?: number
}

export class CodexProviderError extends Error {
  readonly code: string
  readonly data: CodexProviderErrorData

  constructor(code: string, message: string, data: CodexProviderErrorData) {
    super(message)
    this.name = 'CodexProviderError'
    this.code = code
    this.data = data
  }
}

interface CodexAppServerClientLike {
  request: (method: string, params?: unknown) => Promise<unknown>
}

interface ItemNotificationParams {
  item?: { type?: string, id?: string }
}

interface TurnNotificationParams {
  turn?: { id?: string, status?: string, error?: { message?: string } | null }
}

interface ThreadNameUpdatedNotificationParams {
  threadId?: string
  threadName?: string | null
}

interface ThreadResponse {
  thread?: {
    name?: string | null
    title?: string | null
    preview?: string | null
  }
}

interface ErrorNotificationParams {
  message?: string
  willRetry?: boolean
  error?: {
    message?: string
    additionalDetails?: string | null
    codexErrorInfo?: unknown
  }
  code?: string
  details?: unknown
  threadId?: string | null
  turnId?: string | null
}

export function createCodexStreamDiagnostics(): CodexStreamDiagnostics {
  return {
    totalEvents: 0,
    mappedEvents: 0,
    completedTurnEvents: 0,
    retryableErrorEvents: 0,
    eventTypeCounts: {},
    itemTypeCounts: {},
    sampleEvents: [],
    errorEvents: [],
  }
}

export function collectCodexStreamDiagnostics(diagnostics: CodexStreamDiagnostics, notification: CodexAppServerMessage): void {
  const method = notification.method ?? 'response'
  diagnostics.totalEvents += 1
  incrementCount(diagnostics.eventTypeCounts, method)
  if (method === 'turn/completed') {
    diagnostics.completedTurnEvents += 1
  }
  if (notification.method === 'error' && isRetryableCodexAppServerError(notification)) {
    diagnostics.retryableErrorEvents += 1
  }
  const itemType = (notification.params as ItemNotificationParams | undefined)?.item?.type
  if (itemType) {
    incrementCount(diagnostics.itemTypeCounts, itemType)
  }
  if (diagnostics.sampleEvents.length < MAX_EVENT_SAMPLES) {
    diagnostics.sampleEvents.push(buildSampleEvent(notification))
  }
  if (notification.method === 'error' && diagnostics.errorEvents.length < MAX_EVENT_SAMPLES) {
    diagnostics.errorEvents.push(buildDiagnosticNotification(notification))
  }
}

export function getThreadId(notification: CodexAppServerMessage): string | null {
  return (notification.params as { threadId?: string } | undefined)?.threadId ?? null
}

export function getTurnId(notification: CodexAppServerMessage): string | null {
  return (notification.params as TurnNotificationParams | undefined)?.turn?.id ?? null
}

export function getNotificationTurnId(notification: CodexAppServerMessage): string | null {
  return (notification.params as { turnId?: string } | undefined)?.turnId ?? getTurnId(notification)
}

export function readThreadNameUpdate(notification: CodexAppServerMessage, expectedThreadId: string): string | null {
  const params = notification.params as ThreadNameUpdatedNotificationParams | undefined
  if (!params || params.threadId !== expectedThreadId) {
    return null
  }
  return normalizeProviderTitle(params.threadName)
}

export async function readLatestThreadTitle(client: CodexAppServerClientLike, threadId: string): Promise<string | null> {
  try {
    const response = await client.request('thread/read', { threadId, includeTurns: false }) as ThreadResponse
    return readCodexThreadDisplayTitle(response.thread)
  }
  catch {
    return null
  }
}

export function validateCodexStreamOutput(diagnostics: CodexStreamDiagnostics): { ok: boolean, errorText: string | null } {
  if (diagnostics.mappedEvents > 0 || diagnostics.completedTurnEvents > 0) {
    return { ok: true, errorText: null }
  }
  return {
    ok: false,
    errorText: 'Codex app-server stream completed without mapped timeline events',
  }
}

export function createCodexTurnFailureError(
  message: string | undefined,
  diagnostics: CodexStreamDiagnostics,
  notification: CodexAppServerMessage,
): CodexProviderError {
  const summary = summarizeCodexFailureDetails(diagnostics)
  const failureMessage = normalizeProviderErrorMessage(message) ?? 'Codex turn failed'
  return createCodexProviderError(failureMessage, summary, diagnostics, notification)
}

export function createCodexAppServerError(notification: CodexAppServerMessage, diagnostics: CodexStreamDiagnostics): CodexProviderError {
  const params = notification.params as ErrorNotificationParams | undefined
  const message = summarizeCodexErrorMessage(params) ?? 'Codex app-server error'
  const summary = summarizeCodexFailureDetails(diagnostics, notification)
  return createCodexProviderError(message, summary, diagnostics, notification)
}

export function isRetryableCodexAppServerError(notification: CodexAppServerMessage): boolean {
  return (notification.params as ErrorNotificationParams | undefined)?.willRetry === true
}

export function readRetryableCodexAppServerWarning(
  notification: Pick<CodexAppServerMessage, 'method' | 'params'>,
): RuntimeWarningPartData | null {
  if (notification.method !== 'error') {
    return null
  }
  const params = notification.params as ErrorNotificationParams | undefined
  if (params?.willRetry !== true) {
    return null
  }
  const message = normalizeProviderErrorMessage(params.error?.message ?? params.message)
  const additionalDetails = normalizeProviderErrorMessage(params.error?.additionalDetails)
  if (!message && !additionalDetails) {
    return null
  }
  return {
    message: message ?? 'Codex is reconnecting',
    additionalDetails,
  }
}

export function createCodexEmptyStreamError(errorText: string, diagnostics: CodexStreamDiagnostics): CodexProviderError {
  return createCodexProviderError(errorText, summarizeCodexFailureDetails(diagnostics), diagnostics)
}

export function formatCodexDiagnostics(diagnostics: CodexStreamDiagnostics): string {
  const eventTypes = formatCounts(diagnostics.eventTypeCounts)
  const itemTypes = formatCounts(diagnostics.itemTypeCounts)
  const samples = diagnostics.sampleEvents.length > 0
    ? `, samples=${formatDiagnosticValue(diagnostics.sampleEvents)}`
    : ''
  const errors = diagnostics.errorEvents.length > 0
    ? `, errors=${formatDiagnosticValue(diagnostics.errorEvents)}`
    : ''
  return `events_total=${diagnostics.totalEvents}, mapped_events=${diagnostics.mappedEvents}, event_types=${eventTypes}, item_types=${itemTypes}${samples}${errors}`
}

function buildSampleEvent(notification: CodexAppServerMessage): Record<string, unknown> {
  const item = (notification.params as ItemNotificationParams | undefined)?.item
  const base = buildDiagnosticNotification(notification)
  if (!item) {
    return base
  }
  return { ...base, itemType: item.type, itemId: item.id }
}

function buildDiagnosticNotification(notification: CodexAppServerMessage): Record<string, unknown> {
  const sample: Record<string, unknown> = {
    method: notification.method,
  }
  if (notification.error) {
    sample.error = sanitizeDiagnosticValue(notification.error)
  }
  if (notification.params !== undefined) {
    sample.params = sanitizeDiagnosticValue(notification.params)
  }
  if (notification.result !== undefined) {
    sample.result = sanitizeDiagnosticValue(notification.result)
  }
  return sample
}

export function readCodexThreadDisplayTitle(thread: ThreadResponse['thread'] | null | undefined): string | null {
  return normalizeProviderTitle(thread?.name)
    ?? normalizeProviderTitle(thread?.title)
    ?? normalizeProviderTitle(thread?.preview)
}

function createCodexProviderError(
  message: string,
  details: string | null,
  diagnostics: CodexStreamDiagnostics,
  notification?: CodexAppServerMessage,
): CodexProviderError {
  return new CodexProviderError(OBSERVABILITY_CODES.turnStreamFailed, message, {
    details,
    runtimeKind: CODEX_RUNTIME_KIND,
    diagnostics,
    ...(notification ? { notification: buildDiagnosticNotification(notification) } : {}),
  })
}

export function normalizeProviderTitle(title: string | null | undefined): string | null {
  const normalized = title?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1
}

function normalizeProviderErrorMessage(message: string | null | undefined): string | null {
  const normalized = message?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function summarizeCodexErrorMessage(params: ErrorNotificationParams | undefined): string | null {
  const message = normalizeProviderErrorMessage(params?.error?.message ?? params?.message)
  if (!message) {
    return null
  }
  if (/exceeded retry limit/i.test(message)) {
    return 'Codex app-server retry limit exceeded'
  }
  const statusText = readCodexStatusText(params)
  if (statusText) {
    return `Codex app-server request failed with ${statusText.replace(/^status:\s*/, '')}`
  }
  return message
}

function summarizeCodexFailureDetails(
  diagnostics: CodexStreamDiagnostics,
  notification?: CodexAppServerMessage,
): string | null {
  const parts: string[] = []
  const params = notification?.params as ErrorNotificationParams | TurnNotificationParams | undefined
  if (notification?.method === 'error') {
    const errorParams = params as ErrorNotificationParams | undefined
    const additionalDetails = normalizeProviderErrorMessage(errorParams?.error?.additionalDetails)
    if (additionalDetails) {
      parts.push(additionalDetails)
    }
    const statusText = readCodexStatusText(errorParams)
    if (statusText) {
      parts.push(statusText)
    }
    const requestId = readCodexRequestId(errorParams)
    if (requestId) {
      parts.push(`request id: ${requestId}`)
    }
    const providerCode = normalizeProviderErrorMessage(errorParams?.code)
    if (providerCode) {
      parts.push(`provider code: ${providerCode}`)
    }
  }

  if (diagnostics.retryableErrorEvents > 0) {
    parts.push(`retryable errors observed before failure: ${diagnostics.retryableErrorEvents}`)
  }
  parts.push(`events: ${diagnostics.totalEvents} total, ${diagnostics.mappedEvents} mapped`)
  parts.push(`event types: ${formatCounts(diagnostics.eventTypeCounts)}`)
  return parts.length > 0 ? parts.join('; ') : null
}

function readCodexStatusText(params: ErrorNotificationParams | undefined): string | null {
  const message = normalizeProviderErrorMessage(params?.error?.message ?? params?.message)
  const match = message?.match(/last status:\s*([^,]+)/i) ?? message?.match(/unexpected status\s+([^:]+)/i)
  return match ? `status: ${match[1].trim()}` : null
}

function readCodexRequestId(params: ErrorNotificationParams | undefined): string | null {
  const values = [
    params?.error?.message,
    params?.message,
    typeof params?.details === 'string' ? params.details : null,
  ]
  for (const value of values) {
    const match = value?.match(/request id:\s*([a-z0-9-]+)/i)
    if (match) {
      return match[1]
    }
  }
  return null
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) {
    return '-'
  }
  return entries.map(([key, count]) => `${key}:${count}`).join(',')
}

function formatDiagnosticValue(value: unknown): string {
  const text = JSON.stringify(sanitizeDiagnosticValue(value))
  if (text.length <= MAX_DIAGNOSTIC_STRING_LENGTH) {
    return text
  }
  return `${text.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}...<truncated>`
}

function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value
  }
  if (typeof value === 'string') {
    return value.length <= MAX_DIAGNOSTIC_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}...<truncated>`
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value !== 'object') {
    return String(value)
  }
  if (depth >= MAX_DIAGNOSTIC_DEPTH) {
    return '[MaxDepth]'
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_DIAGNOSTIC_ARRAY_ITEMS)
      .map(item => sanitizeDiagnosticValue(item, depth + 1))
    if (value.length > MAX_DIAGNOSTIC_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_DIAGNOSTIC_ARRAY_ITEMS} more items]`)
    }
    return items
  }

  const output: Record<string, unknown> = {}
  const entries = Object.entries(value as Record<string, unknown>)
  for (const [key, item] of entries.slice(0, MAX_DIAGNOSTIC_OBJECT_KEYS)) {
    output[key] = sanitizeDiagnosticValue(item, depth + 1)
  }
  if (entries.length > MAX_DIAGNOSTIC_OBJECT_KEYS) {
    output.__truncatedKeys = entries.length - MAX_DIAGNOSTIC_OBJECT_KEYS
  }
  return output
}
