export class CradleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'CradleApiError'
  }
}

export function errorMessage(error: Error): string {
  if (error instanceof CradleApiError && error.status === 401) {
    return 'The server rejected this access token.'
  }
  if (error instanceof TypeError) {
    return 'The server could not be reached from this device.'
  }
  return error.message
}
