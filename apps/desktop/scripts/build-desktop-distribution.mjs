#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const releaseDir = join(desktopRoot, 'release')
const execFileAsync = promisify(execFile)
const startedAt = Date.now()

const exitCode = await runElectronBuilder(process.argv.slice(2))
if (exitCode !== 0) {
  process.exit(exitCode)
}

if (process.platform === 'darwin') {
  await recompressNewDmgs()
}

async function runElectronBuilder(args) {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const child = spawn(command, ['exec', 'electron-builder', '--config', 'electron-builder.mjs', ...args], {
    cwd: desktopRoot,
    stdio: 'inherit',
  })

  return await new Promise((resolveExitCode, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolveExitCode(code ?? 1))
  })
}

async function recompressNewDmgs() {
  const entries = await readdir(releaseDir, { withFileTypes: true })
  const artifacts = await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || extname(entry.name) !== '.dmg') {
      return null
    }

    const artifactPath = join(releaseDir, entry.name)
    const metadata = await stat(artifactPath)
    return metadata.mtimeMs >= startedAt - 1000 ? artifactPath : null
  }))

  await Promise.all(artifacts.filter(Boolean).map(recompressDmgWithLzma))
}

async function recompressDmgWithLzma(artifactPath) {
  // Electron Builder cannot emit ULMO, but macOS mounts it natively and it is materially smaller.
  const temporaryPath = artifactPath.replace(/\.dmg$/, '.lzma.dmg')
  await rm(temporaryPath, { force: true })
  try {
    await execFileAsync('hdiutil', [
      'convert',
      artifactPath,
      '-format',
      'ULMO',
      '-o',
      temporaryPath,
    ])
    await rename(temporaryPath, artifactPath)
  }
  finally {
    await rm(temporaryPath, { force: true })
  }
}
