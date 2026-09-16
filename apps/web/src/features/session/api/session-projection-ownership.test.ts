import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Ownership ratchet: the Session projection gateway
 * (`features/session/api/session-projection.ts`) is the only place outside
 * `api-gen` that may compose generated Session list/detail query keys or own
 * Session cache topology. External adapters, pages and features must submit
 * semantic facts through the gateway instead.
 */

const SRC_ROOT = join(__dirname, '..', '..', '..')
const SESSION_NAMESPACE = join('features', 'session')
const GENERATED_CLIENT = 'api-gen'
const SELF = join(SESSION_NAMESPACE, 'api', 'session-projection-ownership.test.ts')

const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp, label: string }> = [
  {
    pattern: /\bgetSessionsQueryKey\b/,
    label: 'getSessionsQueryKey',
  },
  {
    pattern: /\bgetSessionsByIdQueryKey\b/,
    label: 'getSessionsByIdQueryKey',
  },
  {
    pattern: /\bgetSessionsOptions\b/,
    label: 'getSessionsOptions',
  },
  {
    pattern: /\bgetSessionsByIdOptions\b/,
    label: 'getSessionsByIdOptions',
  },
  {
    pattern: /['"]chat['"]\s*,\s*['"]session-queue['"]/,
    label: 'literal [\'chat\', \'session-queue\', …] key',
  },
  {
    pattern: /features\/workspace\/use-session/,
    label: 'legacy workspace/use-session import',
  },
  {
    pattern: /\bupdateSessionInSessionLists\b/,
    label: 'legacy updateSessionInSessionLists helper',
  },
  {
    pattern: /\bupdateSessionReadState\b/,
    label: 'legacy updateSessionReadState helper',
  },
]

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(path))
    }
    else if (/\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

describe('session projection ownership', () => {
  it('no module outside features/session composes Session query keys or legacy cache helpers', () => {
    const violations: string[] = []

    for (const file of collectSourceFiles(SRC_ROOT)) {
      const relativePath = relative(SRC_ROOT, file).split(sep).join('/')
      if (
        relativePath === SELF.split(sep).join('/')
        || relativePath.startsWith(`${SESSION_NAMESPACE.split(sep).join('/')}/`)
        || relativePath.startsWith(`${GENERATED_CLIENT}/`)
      ) {
        continue
      }
      const source = readFileSync(file, 'utf8')
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        if (pattern.test(source)) {
          violations.push(`${relativePath}: ${label}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
