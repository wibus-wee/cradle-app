export type JsonPrimitive = boolean | number | string | null
export type JsonArray = readonly JsonValue[]
export type JsonObject = { readonly [key: string]: JsonValue }
export type JsonValue = JsonPrimitive | JsonArray | JsonObject

export function isJsonArray(value: JsonValue): value is JsonArray {
  return Array.isArray(value)
}

export function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === 'object' && !isJsonArray(value)
}

export interface RequestMatch {
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, string | readonly string[]>>
  readonly body?: JsonValue
  readonly bodyFields?: Readonly<Record<string, JsonValue>>
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

export interface StartSimulatorOptions {
  readonly port?: number
}

export interface ModelApiSimulator {
  readonly anthropicBaseUrl: string
  readonly openaiBaseUrl: string
  readonly controller: SimulatorController
  close: () => Promise<void>
}
