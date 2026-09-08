import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const protocolManifest = JSON.parse(
  await readFile(
    join(serverRoot, 'src/modules/chat-runtime-providers/codex/app-server-protocol/MANIFEST.json'),
    'utf8',
  ),
)
const version = protocolManifest.generatorVersion.replace(/^codex-cli /, '')
if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
  throw new Error(`Unrecognized bundled Codex version: ${version}`)
}
const releaseTag = `rust-v${version}`
const source = `https://raw.githubusercontent.com/openai/codex/${releaseTag}/codex-rs/core/config.schema.json`
const response = await fetch(source, { signal: AbortSignal.timeout(30_000) })
if (!response.ok) {
  throw new Error(`Codex config schema download failed: ${response.status} ${source}`)
}
const schema = await response.json()
if (schema.title !== 'ConfigToml' || !schema.properties || !schema.definitions) {
  throw new Error('Expected the Codex ConfigToml JSON schema')
}
const content = `${JSON.stringify(schema, null, 2)}\n`
const output = join(serverRoot, 'src/modules/provider-contracts/codex-config-schema')
await mkdir(output, { recursive: true })
await writeFile(join(output, 'config.schema.json'), content)
await writeFile(
  join(output, 'MANIFEST.json'),
  `${JSON.stringify(
    {
      version,
      releaseTag,
      source,
      sha256: createHash('sha256').update(content).digest('hex'),
    },
    null,
    2,
  )}\n`,
)
console.log(`Synced Codex ${version} config schema`)
