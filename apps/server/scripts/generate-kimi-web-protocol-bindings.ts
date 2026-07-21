import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { KimiAsyncApiDocument } from '../src/modules/chat-runtime-providers/kimi/protocol/generator'
import {
  renderKimiWebSocketCatalogue,
} from '../src/modules/chat-runtime-providers/kimi/protocol/generator'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = join(scriptDir, '..')
const protocolRoot = join(serverRoot, 'src/modules/chat-runtime-providers/kimi/protocol')

const asyncapi = JSON.parse(
  await readFile(join(protocolRoot, 'asyncapi.json'), 'utf8'),
) as KimiAsyncApiDocument

await writeFile(join(protocolRoot, 'websocket.ts'), renderKimiWebSocketCatalogue(asyncapi), 'utf8')
await run('pnpm', ['exec', 'openapi-ts', '--file', 'kimi-openapi-ts.config.ts'])

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: serverRoot, stdio: 'inherit' })
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
