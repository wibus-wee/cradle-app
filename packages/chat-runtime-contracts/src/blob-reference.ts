/**
 * Shared chat blob reference contracts.
 *
 * Server writers (externalization / durable persist) and the web renderer
 * (URL resolution / tool-payload display) must agree on the `cradle-blob:`
 * scheme and the payload-ref object shape. A shared contract has exactly one
 * owner — this package — so neither side invents a private dialect.
 */

export const CRADLE_BLOB_URL_SCHEME = 'cradle-blob:'

const CRADLE_BLOB_URL_PREFIX = `${CRADLE_BLOB_URL_SCHEME}//`

const LEGACY_TRUNCATED_PAYLOAD_TYPES = new Set([
  'cradle.truncated-json-payload.v1',
  'cradle.truncated-text-payload.v1',
])

/**
 * Format a content-addressed blob id as a `cradle-blob://` URL.
 * The id is percent-encoded so opaque ids remain round-trippable in a URL.
 */
export function formatBlobUrl(blobId: string): string {
  return `${CRADLE_BLOB_URL_PREFIX}${encodeURIComponent(blobId)}`
}

/**
 * Decode a `cradle-blob://` URL to its blob id.
 * Returns `null` for non-blob URLs, a bare `cradle-blob://` with no id, or
 * malformed percent-encoding — never throws.
 */
export function parseBlobUrl(url: string): string | null {
  if (!url.startsWith(CRADLE_BLOB_URL_PREFIX)) {
    return null
  }
  const encoded = url.slice(CRADLE_BLOB_URL_PREFIX.length)
  if (encoded.length === 0) {
    return null
  }
  try {
    return decodeURIComponent(encoded)
  }
  catch {
    return null
  }
}

/**
 * True only for inline `data:` URLs (the form externalization replaces).
 * The scheme is matched case-insensitively per RFC 3986, because this guard
 * gates whether bytes get externalized at all.
 */
export function isInlineDataUrl(url: string): boolean {
  return /^data:/i.test(url)
}

/**
 * Reference form written into stored tool `input`/`output` when the payload
 * bytes live in the blob store, and into `providerMetadata.cradle.payloadRef`
 * for text/reasoning overflow.
 *
 * Deliberately a strict superset of the legacy truncation marker
 * (`originalChars` + `preview`, same field names) plus `blobId` and
 * `mediaType`. Keep that overlap — the duplication is intentional so the
 * renderer can treat preview/size uniformly whether or not the remainder is
 * fetchable. Do not "simplify" by dropping the shared fields.
 *
 * The index signature is load-bearing: AI SDK `providerMetadata` values must
 * be `JSONValue` / `JSONObject`, and a named interface without an index
 * signature is not assignable there even when every field is a string or
 * number. Keep `isChatBlobPayloadRef` as the read-side validator.
 */
export type ChatBlobPayloadRef = {
  type: 'cradle.blob-payload-ref.v1'
  blobId: string
  mediaType: string
  originalChars: number
  preview: string
  [key: string]: string | number
}

/**
 * Build a payload ref as a fresh object literal so callers can place it in
 * JSON-typed positions (tool input/output, providerMetadata) without casting.
 */
export function createChatBlobPayloadRef(input: {
  blobId: string
  mediaType: string
  originalChars: number
  preview: string
}): ChatBlobPayloadRef {
  return {
    type: 'cradle.blob-payload-ref.v1',
    blobId: input.blobId,
    mediaType: input.mediaType,
    originalChars: input.originalChars,
    preview: input.preview,
  }
}

export function isChatBlobPayloadRef(value: unknown): value is ChatBlobPayloadRef {
  const record = readRecord(value)
  if (!record) {
    return false
  }
  return (
    record.type === 'cradle.blob-payload-ref.v1'
    && typeof record.blobId === 'string'
    && typeof record.mediaType === 'string'
    && typeof record.originalChars === 'number'
    && typeof record.preview === 'string'
  )
}

/**
 * Text/reasoning overflow refs live at `providerMetadata.cradle.payloadRef`
 * because `part.text` must remain a string for UIMessage / renderer consumers.
 * Returns null when absent or malformed.
 */
export function readCradlePartPayloadRef(
  providerMetadata: unknown,
): ChatBlobPayloadRef | null {
  const metadata = readRecord(providerMetadata)
  if (!metadata) {
    return null
  }
  const cradle = readRecord(metadata.cradle)
  if (!cradle) {
    return null
  }
  return isChatBlobPayloadRef(cradle.payloadRef) ? cradle.payloadRef : null
}

/**
 * Recognise historically written truncation markers
 * (`cradle.truncated-json-payload.v1` / `cradle.truncated-text-payload.v1`).
 * Returns `null` for anything else, including a `ChatBlobPayloadRef` — this
 * is the single place in the repo that describes the legacy marker shape.
 */
export function readLegacyTruncatedPayload(
  value: unknown,
): { preview: string, originalChars: number } | null {
  const record = readRecord(value)
  if (!record) {
    return null
  }
  if (typeof record.type !== 'string' || !LEGACY_TRUNCATED_PAYLOAD_TYPES.has(record.type)) {
    return null
  }
  if (typeof record.preview !== 'string' || typeof record.originalChars !== 'number') {
    return null
  }
  return {
    preview: record.preview,
    originalChars: record.originalChars,
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
