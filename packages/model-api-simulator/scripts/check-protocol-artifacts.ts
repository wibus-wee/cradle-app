import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { generateProtocolArtifacts } from './generate-protocol-artifacts'
import {
  ensureProtocolArtifactCache,
  GENERATED_FILES,
  readGeneratedArtifactManifest,
} from './protocol-artifact-cache'
import { sha256 } from './protocol-utils'

const manifest = await readGeneratedArtifactManifest()
const cache = await ensureProtocolArtifactCache(
  manifest.inputFingerprint,
  generateProtocolArtifacts,
)
const differences: string[] = []
for (const file of GENERATED_FILES) {
  const actual = sha256(await readFile(resolve(cache.directory, file)))
  if (manifest.files[file] !== actual) { differences.push(file) }
}
if (differences.length > 0) {
  throw new Error(`Generated protocol artifact hashes differ: ${differences.join(', ')}`)
}
