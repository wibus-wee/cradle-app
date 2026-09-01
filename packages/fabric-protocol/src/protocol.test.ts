import { describe, expect, it } from 'vitest'

import { base64ToBytes, bytesToBase64, bytesToBase64Url } from './bytes'
import { decodeFabricEnvelope, encodeFabricEnvelope, toFabricSessionEnvelope } from './fabric-envelope'
import {
  generateFabricEncryptionKeyPair,
  generateFabricSigningKeyPair,
  signFabricCertificate,
  signFabricJoinRequest,
  verifyFabricCertificate,
} from './membership'
import {
  decodeInnerFrame,
  encodeInnerFrame,
  FABRIC_SESSION_ENVELOPE_KIND,
  FABRIC_SESSION_PROTOCOL_VERSION,
} from './session-codec'

const deterministicRuntime = {
  nowSeconds: () => 1_800_000_000,
  randomBytes: (length: number) => Uint8Array.from({ length }, (_, index) => (index + 1) & 0xFF),
  randomId: () => 'fixture-id',
}

describe('portable Fabric protocol', () => {
  it('encodes standard and URL-safe Base64 without platform globals', () => {
    const bytes = Uint8Array.of(0, 1, 2, 253, 254, 255)
    expect(bytesToBase64(bytes)).toBe('AAEC/f7/')
    expect(bytesToBase64Url(bytes)).toBe('AAEC_f7_')
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('signs and verifies owner-pinned membership documents', () => {
    const owner = generateFabricSigningKeyPair(deterministicRuntime.randomBytes)
    const identity = generateFabricSigningKeyPair(length => deterministicRuntime.randomBytes(length).reverse())
    const encryption = generateFabricEncryptionKeyPair(deterministicRuntime.randomBytes)
    const certificate = signFabricCertificate(owner.privateKeyBase64, {
      fabricId: 'fab_fixture',
      subjectKind: 'controller',
      subjectId: 'controller_fixture',
      identityPubkey: identity.publicKeyBase64,
      encryptionPubkey: encryption.publicKeyBase64,
      scopes: ['view', 'control'],
    }, deterministicRuntime)

    expect(() => verifyFabricCertificate(
      certificate,
      owner.publicKeyBase64,
      'fab_fixture',
      deterministicRuntime.nowSeconds(),
    )).not.toThrow()
    expect(() => verifyFabricCertificate(
      certificate,
      identity.publicKeyBase64,
      'fab_fixture',
      deterministicRuntime.nowSeconds(),
    )).toThrow('Fabric membership certificate is invalid.')

    const join = signFabricJoinRequest({
      fabricId: 'fab_fixture',
      subjectKind: 'controller',
      subjectId: 'controller_fixture',
      identityPrivateKeyBase64: identity.privateKeyBase64,
      encryptionPubkey: encryption.publicKeyBase64,
      displayName: 'Fixture phone',
      platform: 'ios',
      version: 'test',
      capabilities: ['mobile', 'controller'],
      deliverySecret: 'fixture-delivery-secret',
    }, deterministicRuntime)
    expect(join.deliverySecretHash).toMatch(/^[\w-]{43}$/u)
    expect(join.capabilities).toEqual(['controller', 'mobile'])
  })

  it('round-trips Session hello, stream, and Fabric route frames', () => {
    const hello = {
      kind: 'hello' as const,
      version: FABRIC_SESSION_PROTOCOL_VERSION,
      pubkey: bytesToBase64(new Uint8Array(32).fill(7)),
      selection: false,
      cipherSuites: ['aes-256-gcm' as const],
      compressions: ['none' as const],
    }
    expect(decodeInnerFrame(encodeInnerFrame(hello))).toEqual(hello)

    const route = { fabricId: 'fab_fixture', nodeId: 'node_fixture', linkId: 'link_fixture' }
    const encoded = encodeFabricEnvelope(route, {
      seq: 4,
      kind: FABRIC_SESSION_ENVELOPE_KIND.dataFrame,
      priority: 'data',
      streamId: 'stream_fixture',
      payload: encodeInnerFrame({
        kind: 'stream_data',
        streamId: 'stream_fixture',
        seq: 0,
        data: Uint8Array.of(1, 2, 3),
      }),
    })
    const envelope = decodeFabricEnvelope(encoded)
    expect(envelope).toMatchObject({ ...route, seq: 4, streamId: 'stream_fixture' })
    expect(toFabricSessionEnvelope(envelope)).toMatchObject({
      version: FABRIC_SESSION_PROTOCOL_VERSION,
      linkId: 'link_fixture',
      kind: FABRIC_SESSION_ENVELOPE_KIND.dataFrame,
    })
  })
})
