import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { GENERATED_FILES, generateProtocolArtifacts } from './generate-protocol-artifacts'

const ROOT = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(resolve(tmpdir(), 'model-api-simulator-'))

try {
  await generateProtocolArtifacts(temporary)
  const differences: string[] = []
  for (const file of GENERATED_FILES) {
    const [expected, actual] = await Promise.all([
      readFile(resolve(ROOT, 'src/generated', file)),
      readFile(resolve(temporary, file)),
    ])
    if (!expected.equals(actual)) { differences.push(file) }
  }
  if (differences.length > 0) { throw new Error(`Generated protocol artifacts differ: ${differences.join(', ')}`) }
}
 finally {
  await rm(temporary, { recursive: true, force: true })
}
