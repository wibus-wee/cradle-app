import { base64ToBytes, base64UrlToBytes } from '@cradle/fabric-protocol'

import type { FabricPairingCode } from './fabric-types'

export function parseFabricPairingCode(rawCode: string): FabricPairingCode {
  let pairing: FabricPairingCode
  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(rawCode.trim()))
    pairing = JSON.parse(decoded) as FabricPairingCode
  }
  catch {
    throw new Error('This Fabric code is not valid.')
  }

  if (pairing.version !== 1 || !pairing.fabricId.trim() || !pairing.ownerPubkey.trim()) {
    throw new Error('This Fabric code is incomplete or unsupported.')
  }
  let relay: URL
  try {
    relay = new URL(pairing.relayUrl)
  }
  catch {
    throw new Error('This Fabric code contains an invalid Relay address.')
  }
  if (!['http:', 'https:'].includes(relay.protocol) || relay.origin !== pairing.relayUrl) {
    throw new Error('This Fabric code contains an invalid Relay address.')
  }
  let ownerKeyBytes: Uint8Array
  try {
    ownerKeyBytes = base64ToBytes(pairing.ownerPubkey)
  }
  catch {
    throw new Error('This Fabric code contains an invalid owner identity.')
  }
  if (ownerKeyBytes.length !== 32) {
    throw new Error('This Fabric code contains an invalid owner identity.')
  }

  return {
    version: 1,
    relayUrl: relay.origin,
    fabricId: pairing.fabricId,
    ownerPubkey: pairing.ownerPubkey,
  }
}
