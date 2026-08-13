import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureRoot = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(fixtureRoot, '../../..')
const modeIndex = process.argv.indexOf('--mode')
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : undefined
if (mode !== 'development' && mode !== 'packaged') {
  throw new Error('Usage: node run-smoke.mjs --mode <development|packaged>')
}

const resultPath = resolve(desktopRoot, '.server-fetch-smoke', `${mode}-${process.platform}-${process.arch}.json`)

function executable() {
  if (mode === 'development') {
    return process.platform === 'win32'
      ? resolve(desktopRoot, 'node_modules/electron/dist/electron.exe')
      : resolve(desktopRoot, 'node_modules/electron/dist/electron')
  }
  if (process.platform === 'win32') {
    return resolve(desktopRoot, 'release/server-fetch-smoke/win-unpacked/cradle-server-fetch-smoke.exe')
  }
  if (process.platform === 'darwin') {
    const directory = process.arch === 'arm64' ? 'mac-arm64' : 'mac'
    return resolve(
      desktopRoot,
      `release/server-fetch-smoke/${directory}/Cradle Server Fetch Smoke.app/Contents/MacOS/cradle-server-fetch-smoke`,
    )
  }
  return resolve(desktopRoot, 'release/server-fetch-smoke/linux-unpacked/cradle-server-fetch-smoke')
}

async function main() {
  await rm(resultPath, { force: true })
  const command = executable()
  const args = mode === 'development'
    ? [resolve(desktopRoot, 'dist/server-fetch-smoke/main/index.js')]
    : []
  if (process.env.CRADLE_SERVER_FETCH_SMOKE_NO_SANDBOX === '1') {
    args.push('--no-sandbox')
  }
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    args.push('--headless', '--disable-gpu')
  }

  const outcome = await new Promise((resolveOutcome, reject) => {
    const child = spawn(command, args, {
      cwd: desktopRoot,
      env: { ...process.env, CRADLE_SERVER_FETCH_SMOKE_RESULT: resultPath },
      stdio: 'inherit',
    })
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Server fetch smoke timed out after 60 seconds.'))
    }, 60_000)
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolveOutcome({ code, signal })
    })
  })

  let resultText
  try {
    resultText = await readFile(resultPath, 'utf8')
  }
  catch (error) {
    throw new Error(
      `Server fetch smoke exited before writing its result: ${JSON.stringify(outcome)}`,
      { cause: error },
    )
  }
  const result = JSON.parse(resultText)
  if (outcome.code !== 0 || outcome.signal || result.passed !== true || result.windowCount !== 21) {
    throw new Error(`Server fetch smoke failed: ${JSON.stringify({ outcome, result })}`)
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
