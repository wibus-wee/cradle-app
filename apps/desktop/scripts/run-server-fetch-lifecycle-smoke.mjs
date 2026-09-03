import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import electronPath from 'electron'

const desktopDir = fileURLToPath(new URL('..', import.meta.url))
const repoDir = fileURLToPath(new URL('../../..', import.meta.url))
const smokeDir = join(desktopDir, 'smoke', 'server-fetch-lifecycle')
const outputDir = await mkdtemp(join(tmpdir(), 'cradle-server-fetch-lifecycle-'))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoDir,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  })
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? result.signal ?? 'unknown status'}`)
  }
}

try {
  run('pnpm', [
    'exec',
    'esbuild',
    join(smokeDir, 'main.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node22',
    '--external:electron',
    `--outfile=${join(outputDir, 'main.cjs')}`,
  ])
  run('pnpm', [
    'exec',
    'esbuild',
    join(smokeDir, 'preload.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node22',
    '--external:electron',
    `--outfile=${join(outputDir, 'preload.cjs')}`,
  ])
  await copyFile(join(smokeDir, 'renderer.html'), join(outputDir, 'renderer.html'))
  const electronEnv = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
  }
  delete electronEnv.ELECTRON_RUN_AS_NODE
  run(electronPath, [join(outputDir, 'main.cjs')], {
    env: electronEnv,
    timeout: 30_000,
  })
}
finally {
  await rm(outputDir, { recursive: true, force: true })
}
