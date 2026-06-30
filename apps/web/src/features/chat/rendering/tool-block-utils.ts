// ---------------------------------------------------------------------------
// Regex constants (single source of truth)
// ---------------------------------------------------------------------------

export const BACKSLASH_PATTERN = /\\/g
export const LINE_BREAK_PATTERN = /\r?\n/

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function basename(value: string): string {
  return value.replace(BACKSLASH_PATTERN, '/').split('/').filter(Boolean).pop() ?? value
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

export function readFirstLine(value: string | null): string | null {
  if (!value) {
    return null
  }
  return value.split(LINE_BREAK_PATTERN, 1)[0] ?? value
}
