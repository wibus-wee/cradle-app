import type { MembershipCertificate } from '@cradle/fabric-protocol'
import {
  generateFabricEncryptionKeyPair,
  generateFabricSigningKeyPair,
} from '@cradle/fabric-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FabricHttpTransport } from './fabric-http-transport'

vi.mock('@/features/fabric/fabric-runtime', () => ({
  mobileFabricRuntime: {
    nowSeconds: () => 1_800_000_000,
    randomBytes: (length: number) => new Uint8Array(length).fill(9),
    randomId: () => 'runtime-id',
  },
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))

const signingKeys = generateFabricSigningKeyPair(length => new Uint8Array(length).fill(3))
const encryptionKeys = generateFabricEncryptionKeyPair(length => new Uint8Array(length).fill(5))
const controllerCertificate: MembershipCertificate = {
  version: 1,
  fabricId: 'fabric-test',
  subjectKind: 'controller',
  subjectId: 'controller-test',
  identityPubkey: signingKeys.publicKeyBase64,
  encryptionPubkey: encryptionKeys.publicKeyBase64,
  scopes: ['control'],
  issuedAt: 1_800_000_000,
  nonce: 'certificate-nonce',
  issuerPubkey: signingKeys.publicKeyBase64,
  signature: 'test-signature',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mobile Fabric HTTP transport lifecycle', () => {
  it('aborts an in-flight link request when the transport closes', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const websocketConstructor = vi.fn(() => {
      throw new Error('WebSocket must not start after transport disposal.')
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('WebSocket', websocketConstructor)

    const transport = new FabricHttpTransport({
      relayUrl: 'https://relay.example.com',
      fabricId: 'fabric-test',
      ownerPubkey: signingKeys.publicKeyBase64,
      controllerCertificate,
    }, {
      identityPrivateKeyBase64: signingKeys.privateKeyBase64,
      encryptionPrivateKeyBase64: encryptionKeys.privateKeyBase64,
    }, 'node-test')

    const request = transport.request('/work', { method: 'POST' })
    expect(fetchMock).toHaveBeenCalledOnce()

    transport.close('Fabric transport disposed.')

    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    await expect(request).rejects.toThrow('Fabric transport disposed.')
    expect(websocketConstructor).not.toHaveBeenCalled()
  })
})
