import type {
  JsonObject,
  JsonValue,
  OpenAiInputItemsPage,
  OpenAiResourceEffect,
} from '../contract'
import type { MatchedOperation } from '../core/operation-registry'

export class OpenAiResourceNotFoundError extends Error {
  override readonly name = 'OpenAiResourceNotFoundError'
}

export class OpenAiInvalidResourceTransitionError extends Error {
  override readonly name = 'OpenAiInvalidResourceTransitionError'
}

interface StoredResponse {
  response: JsonObject
  inputItemPages: readonly OpenAiInputItemsPage[]
}

export class OpenAiResourceStore {
  readonly #responses = new Map<string, StoredResponse>()

  reset(): void {
    this.#responses.clear()
  }

  apply(
    effect: OpenAiResourceEffect,
    operation: MatchedOperation,
    request: Request,
    scenarioBody: JsonValue,
  ): JsonValue {
    switch (effect.kind) {
      case 'store_response':
        this.store(effect.response, effect.inputItemPages ?? [])
        return scenarioBody
      case 'retrieve_response':
        return this.retrieve(responseId(operation))
      case 'cancel_response':
        return this.cancel(responseId(operation))
      case 'delete_response': {
        const id = responseId(operation)
        this.delete(id)
        return { id, object: 'response', deleted: true }
      }
      case 'list_input_items':
        return this.listInputItems(
          responseId(operation),
          new URL(request.url).searchParams.get('after') ?? undefined,
        )
    }
  }

  store(response: JsonObject, inputItemPages: readonly OpenAiInputItemsPage[]): void {
    const id = response.id
    if (typeof id !== 'string') { throw new TypeError('Response resource requires a string id') }
    const pageKeys = new Set<string>()
    for (const page of inputItemPages) {
      const key = page.after ?? ''
      if (pageKeys.has(key)) { throw new TypeError(`Duplicate input-items page cursor "${key}"`) }
      pageKeys.add(key)
    }
    this.#responses.set(id, {
      response: structuredClone(response),
      inputItemPages: structuredClone(inputItemPages),
    })
  }

  retrieve(id: string): JsonObject {
    return structuredClone(this.#entry(id).response)
  }

  cancel(id: string): JsonObject {
    const entry = this.#entry(id)
    const status = entry.response.status
    if (status !== 'queued' && status !== 'in_progress') {
      throw new OpenAiInvalidResourceTransitionError(
        `Response "${id}" in status "${String(status)}" is not cancellable`,
      )
    }
    entry.response = { ...entry.response, status: 'cancelled' }
    return structuredClone(entry.response)
  }

  delete(id: string): void {
    if (!this.#responses.delete(id)) {
      throw new OpenAiResourceNotFoundError(`Unknown response "${id}"`)
    }
  }

  listInputItems(id: string, after?: string): JsonObject {
    const entry = this.#entry(id)
    const page = entry.inputItemPages.find(candidate => candidate.after === after)
    if (!page) {
      throw new OpenAiResourceNotFoundError(
        `Response "${id}" has no input-items page after "${after ?? ''}"`,
      )
    }
    return structuredClone(page.body)
  }

  #entry(id: string): StoredResponse {
    const entry = this.#responses.get(id)
    if (!entry) { throw new OpenAiResourceNotFoundError(`Unknown response "${id}"`) }
    return entry
  }
}

function responseId(operation: MatchedOperation): string {
  const id = operation.pathParameters.response_id
  if (!id) { throw new TypeError(`Operation "${operation.id}" has no response_id path parameter`) }
  return id
}
