import { createHash } from 'node:crypto'

import type { KimiWebHostOptions } from './web-host'

/**
 * Kimi's provider configuration is process-global. The provider target is the
 * host scope; session id deliberately never participates in this fingerprint.
 */
export function createKimiWebHostFingerprint(input: KimiWebHostOptions): string {
  return JSON.stringify({
    command: input.command,
    providerTargetId: input.providerTargetId,
    providerConfig: stableJson(input.providerConfig),
    credentialFingerprint: input.credential ? sha256(input.credential) : null,
  })
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJson)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJson(entry)]),
    )
  }
  return value
}
