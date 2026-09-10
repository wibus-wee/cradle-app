import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

async function main() {
  const root = dirname(fileURLToPath(import.meta.url))
  const version = (await readFile(resolve(root, 'version.txt'), 'utf8')).trim()
  if (version !== 'v1' && version !== 'v2') {
    throw new Error(`Unsupported E2E personal Plugin version: ${version}`)
  }

  await mkdir(resolve(root, 'dist'), { recursive: true })
  await copyFile(resolve(root, 'src', `web-${version}.mjs`), resolve(root, 'dist', 'web.mjs'))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
