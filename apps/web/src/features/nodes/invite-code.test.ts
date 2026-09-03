import { describe, expect, it } from 'vitest'

import {
  decodeInviteCode,
  encodeControllerPairingCode,
} from './invite-code'

describe('fabric Controller pairing code', () => {
  it('includes the versioned Mobile trust bootstrap contract', () => {
    const encoded = encodeControllerPairingCode({
      relayUrl: 'https://relay.example.com',
      fabricId: 'fabric-1',
      ownerPubkey: 'owner-key',
    })

    expect(decodeInviteCode(encoded)).toEqual({
      version: 1,
      relayUrl: 'https://relay.example.com',
      fabricId: 'fabric-1',
      ownerPubkey: 'owner-key',
    })
  })
})
