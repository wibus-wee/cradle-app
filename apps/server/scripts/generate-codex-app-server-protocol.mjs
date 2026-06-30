import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ensureCodexRuntime,
  readCodexRuntimeVersion,
} from '../../desktop/scripts/sync-codex-runtime.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = join(scriptDir, '..')
const repoRoot = join(serverRoot, '../..')
const codexRoot = join(serverRoot, 'src/modules/chat-runtime-providers/codex')
const protocolRoot = join(codexRoot, 'app-server-protocol')
const manifestPath = join(protocolRoot, 'MANIFEST.json')

const runtime = await ensureCodexRuntime()
const command = [
  runtime.executablePath,
  'app-server',
  'generate-ts',
  '--experimental',
  '--out',
  protocolRoot,
]

await run(command[0], command.slice(1))

const generatorVersion = await readCodexRuntimeVersion(runtime.executablePath)
await writeFile(manifestPath, `${JSON.stringify({
  owner: 'apps/server/src/modules/chat-runtime-providers/codex',
  protocol: 'codex-app-server',
  bindings: 'typescript',
  generator: 'codex app-server generate-ts',
  generatorVersion: generatorVersion ?? runtime.manifest.binary.version ?? runtime.manifest.release.tagName,
  experimental: true,
  command: 'pnpm --filter @cradle/server generate:codex-app-server-protocol',
  generatedDate: new Date().toISOString().slice(0, 10),
  notes: [
    'Codex app-server does not expose a separate schema version in generated files; generatorVersion is the schema source version.',
    'Regenerate with pnpm --filter @cradle/server generate:codex-app-server-protocol so Cradle uses the vendored Codex runtime, not a global codex command.',
  ],
}, null, 2)}\n`, 'utf8')

function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${file} ${args.join(' ')} failed with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}`))
    })
  })
}
