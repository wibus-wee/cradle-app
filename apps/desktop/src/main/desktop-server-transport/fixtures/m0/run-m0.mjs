import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runCommand } from './command-runner.mjs'
import { resolveM0LaunchPolicy } from './launch-policy.mjs'
import { validateM0Result } from './result-contract.mjs'

const fixtureRoot = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(fixtureRoot, '../../../../..')
const modeIndex = process.argv.indexOf('--mode')
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : undefined
if (mode !== 'development' && mode !== 'packaged') {
  throw new Error('Usage: node run-m0.mjs --mode <development|packaged>')
}

const platformKey = `${process.platform}-${process.arch}`
const resultDirectory = resolve(desktopRoot, '.m0-results')
const resultPath = resolve(resultDirectory, `${mode}-${platformKey}.json`)
const stdoutPath = resolve(resultDirectory, `${mode}-${platformKey}.stdout.log`)
const stderrPath = resolve(resultDirectory, `${mode}-${platformKey}.stderr.log`)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const timeoutMs = process.platform === 'win32' ? 180_000 : 120_000
const launchPolicy = resolveM0LaunchPolicy()

function packagedArtifactPath() {
  if (process.platform === 'linux' && process.arch === 'x64') {
    return resolve(desktopRoot, 'release/m0/linux-unpacked/cradle-m0-gate')
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return resolve(desktopRoot, 'release/m0/win-unpacked/cradle-m0-gate.exe')
  }
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return resolve(desktopRoot, 'release/m0/mac-arm64/Cradle M0 Gate.app/Contents/MacOS/cradle-m0-gate')
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return resolve(desktopRoot, 'release/m0/mac/Cradle M0 Gate.app/Contents/MacOS/cradle-m0-gate')
  }
  throw new Error(`M0 has no deterministic packaged artifact path for ${platformKey}`)
}

async function main() {
  await mkdir(resultDirectory, { recursive: true })
  await unlink(resultPath).catch((error) => {
    if (error.code !== 'ENOENT') { throw error }
  })

  let stdout = ''
  let stderr = ''
  let outcome
  let artifactPath = null
  try {
    if (mode === 'development') {
      const prepare = await runCommand(pnpm, ['m0:custom-scheme:prepare'], {
        cwd: desktopRoot,
        timeoutMs,
      })
      stdout += prepare.stdout
      stderr += prepare.stderr
      if (prepare.timedOut) {
        throw new Error(`M0 prepare timed out after ${timeoutMs}ms`)
      }
      if (prepare.code !== 0 || prepare.signal) {
        throw new Error(`M0 prepare failed with code ${prepare.code} signal ${prepare.signal ?? 'none'}`)
      }
      outcome = await runCommand(pnpm, [
        'exec',
        'electron-vite',
        'dev',
        ...launchPolicy.developmentArgs,
        '--config',
        'src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts',
        '--entry',
        'dist/m0/main/index.js',
      ], {
        cwd: desktopRoot,
        env: {
          ...process.env,
          CRADLE_M0_MODE: mode,
          CRADLE_M0_RESULT_PATH: resultPath,
          CRADLE_M0_ARTIFACT_PATH: '',
        },
        timeoutMs,
      })
    }
    else {
      artifactPath = packagedArtifactPath()
      await access(artifactPath, fsConstants.X_OK)
      outcome = await runCommand(artifactPath, launchPolicy.packagedArgs, {
        cwd: desktopRoot,
        env: {
          ...process.env,
          CRADLE_M0_MODE: mode,
          CRADLE_M0_RESULT_PATH: resultPath,
          CRADLE_M0_ARTIFACT_PATH: artifactPath,
        },
        timeoutMs,
      })
    }
    stdout += outcome.stdout
    stderr += outcome.stderr
  }
  finally {
    await writeFile(stdoutPath, stdout, 'utf8')
    await writeFile(stderrPath, stderr, 'utf8')
  }

  if (!outcome) { throw new Error('M0 launch did not produce a process outcome') }
  if (outcome.timedOut) {
    throw new Error(`M0 ${mode} process timed out after ${timeoutMs}ms`)
  }
  if (outcome.signal || outcome.code !== 0) {
    throw new Error(`M0 ${mode} process failed with code ${outcome.code} signal ${outcome.signal ?? 'none'}`)
  }

  const result = JSON.parse(await readFile(resultPath, 'utf8'))
  const validation = validateM0Result(result, {
    mode,
    artifactPath,
    platform: process.platform,
    arch: process.arch,
    noSandbox: launchPolicy.noSandbox,
  })
  if (!validation.ok) {
    throw new Error(`M0 result validation failed:\n${validation.errors.map(error => `- ${error}`).join('\n')}`)
  }
  console.log(`[m0:runner] validated ${resultPath}`)
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
