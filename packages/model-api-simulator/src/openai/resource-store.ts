import type { JsonValue } from '../contract'

export class OpenAiResourceStore {
  readonly #responses = new Map<string, Record<string, JsonValue>>()

  set(response: Record<string, JsonValue>): void {
    const id = response.id
    if (typeof id !== 'string') { throw new TypeError('Response resource requires an id') }
    this.#responses.set(id, structuredClone(response))
  }

  retrieve(id: string): Record<string, JsonValue> | undefined {
    const response = this.#responses.get(id)
    return response ? structuredClone(response) : undefined
  }

  cancel(id: string): Record<string, JsonValue> {
    const response = this.#responses.get(id)
    if (!response) { throw new Error(`Unknown response "${id}"`) }
    if (!['queued', 'in_progress'].includes(String(response.status))) { throw new Error(`Response "${id}" is not cancellable`) }
    response.status = 'cancelled'
    return structuredClone(response)
  }

  delete(id: string): boolean {
    return this.#responses.delete(id)
  }
}
