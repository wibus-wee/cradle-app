export type JsonPrimitive = boolean | number | string | null
export type JsonArray = readonly JsonValue[]
export type JsonObject = { readonly [key: string]: JsonValue }
export type JsonValue = JsonPrimitive | JsonArray | JsonObject

export function isJsonArray(value: JsonValue | undefined): value is JsonArray {
  return Array.isArray(value)
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && value !== undefined && typeof value === 'object' && !isJsonArray(value)
}

export interface RequestMatch {
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, string | readonly string[]>>
  readonly body?: JsonValue
  readonly bodyFields?: Readonly<Record<string, JsonValue>>
  /**
   * Match when the JSON-stringified request body contains each of these
   * substrings. Useful for Claude Agent / Codex turns that share the same path
   * but differ by user prompt text buried in nested message arrays.
   */
  readonly bodyTextIncludes?: string | readonly string[]
  /** Fail the match when any of these substrings appear in the body text. */
  readonly bodyTextExcludes?: string | readonly string[]
}

export interface ObservedRequest {
  readonly index: number
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, string | readonly string[]>>
  readonly headers: Readonly<Record<string, string>>
  readonly body?: JsonValue
}

export interface OpenAiInputItemsPage {
  readonly after?: string
  readonly body: JsonObject
}

export type OpenAiResourceEffect
  = | {
      readonly kind: 'store_response'
      readonly response: JsonObject
      readonly inputItemPages?: readonly OpenAiInputItemsPage[]
    }
    | { readonly kind: 'retrieve_response' }
    | { readonly kind: 'cancel_response' }
    | { readonly kind: 'delete_response' }
    | { readonly kind: 'list_input_items' }

export type StreamStep
  = | { readonly kind: 'event', readonly event: JsonValue }
    | { readonly kind: 'gate', readonly name: string }
    | { readonly kind: 'yield' }
    | { readonly kind: 'close' }
    | { readonly kind: 'disconnect', readonly reason: string }

export interface SimulatorExchange {
  readonly label: string
  readonly request: RequestMatch
  readonly expectedHeaders?: Readonly<Record<string, string>>
  readonly resourceEffect?: OpenAiResourceEffect
  readonly response:
    | {
        readonly kind: 'json'
        readonly status?: number
        readonly headers?: Readonly<Record<string, string>>
        readonly body: JsonValue
      }
      | {
        readonly kind: 'stream'
        readonly status?: number
        readonly headers?: Readonly<Record<string, string>>
        readonly steps: readonly StreamStep[]
      }
}

export type SimulatorScenario
  = | { readonly provider: 'anthropic', readonly exchanges: readonly SimulatorExchange[] }
    | { readonly provider: 'openai', readonly exchanges: readonly SimulatorExchange[] }

export interface SimulatorController {
  enqueue: (scenario: SimulatorScenario) => void
  waitForRequest: (match: RequestMatch) => Promise<ObservedRequest>
  waitForGate: (gate: string) => Promise<void>
  release: (gate: string) => void
  requests: () => readonly ObservedRequest[]
  assertExhausted: () => void
  reset: () => void
}

export type AutoRespondMode = boolean | 'probes-only'

export interface StartSimulatorOptions {
  readonly port?: number
  /** When true, request bodies are validated against the provider schema (default: false). */
  readonly strictRequestValidation?: boolean
  /**
   * Auto-response policy for unmatched requests:
   * - `false` (default): unmatched requests fail with UnexpectedRequestError
   * - `true`: synthesise a protocol-valid response for any unmatched request
   * - `'probes-only'`: synthesise for probe paths (token count, models, etc.) and
   *   for unmatched conversation creates only while exchanges remain queued
   *   (so SDK noise cannot steal FIFO). Unmatched conversation creates fail when
   *   the queue is empty — this is what E2E should use to catch unexpected turns.
   */
  readonly autoRespond?: AutoRespondMode
}

export interface ModelApiSimulator {
  readonly anthropicBaseUrl: string
  readonly openaiBaseUrl: string
  readonly controller: SimulatorController
  close: () => Promise<void>
}
