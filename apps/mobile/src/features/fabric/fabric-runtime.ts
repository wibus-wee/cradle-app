import type { FabricProtocolRuntime } from '@cradle/fabric-protocol'
import * as Crypto from 'expo-crypto'

export const mobileFabricRuntime: FabricProtocolRuntime = {
  nowSeconds: () => Math.floor(Date.now() / 1000),
  randomBytes: length => Crypto.getRandomValues(new Uint8Array(length)),
  randomId: () => Crypto.randomUUID(),
}
