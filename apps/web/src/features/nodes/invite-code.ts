/**
 * Compact, copy-paste-friendly encoding for one-time Fabric enrollment
 * invitations. The wire payload stays the server-defined JSON document; this
 * is only its presentation form (base64url of the UTF-8 JSON bytes).
 */
export function encodeInviteCode(invitation: unknown): string {
  const json = JSON.stringify(invitation)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Parse a pasted invite code back into the invitation JSON. Returns null when malformed. */
export function decodeInviteCode<T = unknown>(code: string): T | null {
  const trimmed = code.trim()
  if (!trimmed) {
    return null
  }
  try {
    const base64 = trimmed.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  }
  catch {
    return null
  }
}

export interface ControllerPairingCode {
  version: 1
  relayUrl: string
  fabricId: string
  ownerPubkey: string
}

/** Encode the durable trust bootstrap shared with Controller-only clients. */
export function encodeControllerPairingCode(
  membership: Omit<ControllerPairingCode, 'version'>,
): string {
  return encodeInviteCode({ version: 1, ...membership })
}
