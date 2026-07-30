export function readApiErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const record = error as Record<string, unknown>
  if (typeof record.code === 'string') {
    return record.code
  }

  const nested = record.error
  if (nested && typeof nested === 'object') {
    const nestedCode = (nested as Record<string, unknown>).code
    if (typeof nestedCode === 'string') {
      return nestedCode
    }
  }

  return null
}

export function apiErrorMessage(error: unknown): string {
  if (!error) {
    return 'Unknown error'
  }
  if (error instanceof Error) {
    return error.message || 'Unknown error'
  }
  if (typeof error === 'string') {
    return error
  }
  if (typeof error === 'object') {
    const record = error as Record<string, unknown>
    const message = readErrorString(record.message)
      ?? readErrorString(record.error)
      ?? readNestedErrorMessage(record)
    if (message) {
      return message
    }
  }
  return String(error)
}

function readErrorString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readNestedErrorMessage(record: Record<string, unknown>): string | null {
  const nested = record.error
  return nested && typeof nested === 'object'
    ? apiErrorMessage(nested)
    : null
}
