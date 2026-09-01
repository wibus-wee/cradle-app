export class FabricTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'FabricTransportError'
  }
}

/** Retry only idempotent reads that could not have exposed a response. */
export function shouldRetryFabricRead(
  method: string,
  init: Pick<RequestInit, 'body' | 'signal'>,
  error: Error,
): boolean {
  if (
    init.signal?.aborted
    || (init.body !== null && init.body !== undefined)
    || !['GET', 'HEAD'].includes(method)
  ) {
    return false
  }
  return error instanceof TypeError
    || (error instanceof FabricTransportError
      && (error.status === undefined || error.status >= 500))
}
