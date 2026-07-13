import { createHash } from 'node:crypto'

import { jsonrepair } from 'jsonrepair'

export function safeJsonParse(value: string | null | undefined): unknown | null {
  if (!value) {
    return null
  }
  try {
    return JSON.parse(value) as unknown
  }
  catch {
    // LLM artifacts (commit plans, guides) often ship trailing commas / soft quotes.
    // Prefer strict parse first so trusted stored JSON never goes through repair.
    try {
      return JSON.parse(jsonrepair(value)) as unknown
    }
    catch {
      return null
    }
  }
}

export function jsonStringify(value: unknown): string {
  return JSON.stringify(value ?? {})
}

export function hashText(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function shortHash(input: string): string {
  return hashText(input).slice(0, 16)
}

export function titleForRepository(repositoryName: string): string {
  return repositoryName ? `${repositoryName} Working Tree` : 'Working Tree Changes'
}
