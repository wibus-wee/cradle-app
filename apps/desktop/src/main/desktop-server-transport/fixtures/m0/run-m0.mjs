import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { runCommand } from './command-runner.mjs'
import { fileDiagnostic, serializeDiagnosticError, writeDiagnosticEnvelope } from './diagnostic-envelope.mjs'
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
const diagnosticPath = resolve(resultDirectory, `${mode}-${platformKey}.diagnostic.json`)
const lifecyclePath = resolve(resultDirectory, `${mode}-${platformKey}.lifecycle.jsonl`)
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

function packagedAsarPath(artifactPath) {
  if (process.platform === 'darwin') {
    return resolve(dirname(artifactPath), '../Resources/app.asar')
  }
  return resolve(dirname(artifactPath), 'resources/app.asar')
}

function ciIdentity() {
  return {
    githubActions: process.env.GITHUB_ACTIONS === 'true',
    githubSha: process.env.GITHUB_SHA ?? null,
    githubRunId: process.env.GITHUB_RUN_ID ?? null,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    githubJob: process.env.GITHUB_JOB ?? null,
  }
}

async function windowsProcessInventory(artifactPath) {
  if (process.platform !== 'win32' || !artifactPath) { return null }
  try {
    const outcome = await runCommand('tasklist', [
      '/FI',
      `IMAGENAME eq ${basename(artifactPath)}`,
      '/FO',
      'CSV',
      '/NH',
    ], {
      cwd: desktopRoot,
      timeoutMs: 5_000,
      forwardOutput: false,
    })
    return {
      code: outcome.code,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      stdout: outcome.stdout.slice(0, 16_384),
      stderr: outcome.stderr.slice(0, 16_384),
    }
  }
  catch (error) {
    return { error: serializeDiagnosticError(error) }
  }
}

async function main() {
  await mkdir(resultDirectory, { recursive: true })
  for (const path of [resultPath, stdoutPath, stderrPath, diagnosticPath, lifecyclePath]) {
    await unlink(path).catch((error) => {
      if (error.code !== 'ENOENT') { throw error }
    })
  }

  const runnerStartedAt = new Date().toISOString()
  let stdout = ''
  let stderr = ''
  let outcome
  let artifactPath = null
  let launchCommand = null
  let launchArgs = []
  let diagnosticEnvelope = {
    schemaVersion: 1,
    kind: 'm0-runner-diagnostic',
    mode,
    platform: process.platform,
    arch: process.arch,
    expectedElectronVersion: '42.4.1',
    runner: {
      pid: process.pid,
      nodeVersion: process.version,
      cwd: desktopRoot,
      startedAt: runnerStartedAt,
    },
    ci: ciIdentity(),
    paths: {
      result: resultPath,
      stdout: stdoutPath,
      stderr: stderrPath,
      diagnostic: diagnosticPath,
      lifecycle: lifecyclePath,
      artifact: null,
      appAsar: null,
    },
    artifacts: [],
    launch: null,
    settlement: null,
    result: { exists: false },
    lifecycle: { exists: false },
  }
  await writeDiagnosticEnvelope(diagnosticPath, diagnosticEnvelope)

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
      launchCommand = pnpm
      launchArgs = [
        'exec',
        'electron-vite',
        'dev',
        ...launchPolicy.developmentArgs,
        '--config',
        'src/main/desktop-server-transport/fixtures/m0/electron.vite.config.ts',
        '--entry',
        'dist/m0/main/index.js',
      ]
    }
    else {
      artifactPath = packagedArtifactPath()
      await access(artifactPath, fsConstants.X_OK)
      launchCommand = artifactPath
      launchArgs = launchPolicy.packagedArgs
      const appAsarPath = packagedAsarPath(artifactPath)
      diagnosticEnvelope.paths.artifact = artifactPath
      diagnosticEnvelope.paths.appAsar = appAsarPath
      diagnosticEnvelope.artifacts = [
        await fileDiagnostic(artifactPath, { hash: true }),
        await fileDiagnostic(appAsarPath, { hash: true }),
      ]
    }

    diagnosticEnvelope.launch = {
      checkpoint: 'before-spawn',
      recordedAt: new Date().toISOString(),
      command: launchCommand,
      args: launchArgs,
      timeoutMs,
      noSandbox: launchPolicy.noSandbox,
      environmentPresence: {
        mode: true,
        resultPath: true,
        artifactPath: mode === 'packaged',
        lifecyclePath: true,
      },
    }
    await writeDiagnosticEnvelope(diagnosticPath, diagnosticEnvelope)

    outcome = await runCommand(launchCommand, launchArgs, {
      cwd: desktopRoot,
      env: {
        ...process.env,
        CRADLE_M0_MODE: mode,
        CRADLE_M0_RESULT_PATH: resultPath,
        CRADLE_M0_ARTIFACT_PATH: artifactPath ?? '',
        CRADLE_M0_LIFECYCLE_PATH: lifecyclePath,
      },
      timeoutMs,
    })
    stdout += outcome.stdout
    stderr += outcome.stderr
  }
  catch (error) {
    diagnosticEnvelope.settlement = {
      checkpoint: outcome ? 'after-settlement' : 'launch-error',
      recordedAt: new Date().toISOString(),
      error: serializeDiagnosticError(error),
    }
    throw error
  }
  finally {
    await writeFile(stdoutPath, stdout, 'utf8')
    await writeFile(stderrPath, stderr, 'utf8')
    const [resultEvidence, lifecycleEvidence, stdoutEvidence, stderrEvidence] = await Promise.all([
      fileDiagnostic(resultPath),
      fileDiagnostic(lifecyclePath),
      fileDiagnostic(stdoutPath),
      fileDiagnostic(stderrPath),
    ])
    diagnosticEnvelope = {
      ...diagnosticEnvelope,
      settlement: outcome
        ? {
            checkpoint: 'after-settlement',
            recordedAt: new Date().toISOString(),
            directProcess: {
              pid: outcome.pid,
              code: outcome.code,
              signal: outcome.signal,
              timedOut: outcome.timedOut,
              startedAt: outcome.startedAt,
              settledAt: outcome.settledAt,
              elapsedMs: outcome.elapsedMs,
            },
            stdoutBytes: Buffer.byteLength(outcome.stdout),
            stderrBytes: Buffer.byteLength(outcome.stderr),
            matchingWindowsProcesses: await windowsProcessInventory(artifactPath),
          }
        : diagnosticEnvelope.settlement,
      result: resultEvidence,
      lifecycle: lifecycleEvidence,
      output: { stdout: stdoutEvidence, stderr: stderrEvidence },
    }
    await writeDiagnosticEnvelope(diagnosticPath, diagnosticEnvelope)
  }

  if (!outcome) { throw new Error(`M0 launch produced no process outcome; evidence: ${diagnosticPath}`) }
  if (outcome.timedOut) {
    throw new Error(`M0 ${mode} process timed out after ${timeoutMs}ms; evidence: ${diagnosticPath}`)
  }
  if (outcome.signal || outcome.code !== 0) {
    throw new Error(`M0 ${mode} process failed with code ${outcome.code} signal ${outcome.signal ?? 'none'}; evidence: ${diagnosticPath}`)
  }
  if (!diagnosticEnvelope.result.exists) {
    throw new Error(`M0 ${mode} process exited without result JSON; inspect diagnostic envelope ${diagnosticPath} and lifecycle evidence ${lifecyclePath}`)
  }
  if (!diagnosticEnvelope.lifecycle.exists || diagnosticEnvelope.lifecycle.size === 0) {
    throw new Error(`M0 ${mode} process produced no Main lifecycle evidence; inspect diagnostic envelope ${diagnosticPath}`)
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
