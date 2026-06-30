#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDir, '..')
const manifestScriptPath = path.join(scriptDir, 'generate-update-manifest.mjs')

function printUsage() {
  console.log(`Usage: pnpm --filter @cradle/desktop smoke:update -- --new-zip <path> --version <version> [options]

Options:
  --new-zip <path>   New macOS zip artifact used by the update feed.
  --version <value>  New app version written into manifest.json.
  --old-app <path>   Existing Cradle.app bundle to launch for the manual smoke.
  --arch <arch>      Artifact architecture: arm64, x64, or universal.
  --feed-dir <path>  Directory for generated update feed. Defaults to a temp directory.
  --launch           Launch old app executable with CRADLE_DESKTOP_UPDATE_URL set.
  --port <number>    Local feed server port. Defaults to an available port.
  --keep-feed        Do not remove a generated temporary feed directory on exit.
`)
}

function parseArgs(argv) {
  const options = {
    arch: null,
    feedDir: null,
    keepFeed: false,
    launch: false,
    newZip: null,
    oldApp: null,
    port: 0,
    version: null,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }

    switch (arg) {
      case '--arch':
        options.arch = readOptionValue(arg, argv[++index])
        break
      case '--feed-dir':
        options.feedDir = path.resolve(desktopRoot, readOptionValue(arg, argv[++index]))
        break
      case '--keep-feed':
        options.keepFeed = true
        break
      case '--launch':
        options.launch = true
        break
      case '--new-zip':
        options.newZip = path.resolve(desktopRoot, readOptionValue(arg, argv[++index]))
        break
      case '--old-app':
        options.oldApp = path.resolve(desktopRoot, readOptionValue(arg, argv[++index]))
        break
      case '--port':
        options.port = readPort(readOptionValue(arg, argv[++index]))
        break
      case '--version':
        options.version = readOptionValue(arg, argv[++index])
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  if (!options.newZip) {
    throw new Error('--new-zip is required')
  }
  if (!options.version) {
    throw new Error('--version is required')
  }
  if (options.launch && !options.oldApp) {
    throw new Error('--launch requires --old-app')
  }

  return options
}

function readOptionValue(name, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function readPort(value) {
  const port = Number.parseInt(value, 10)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${value}`)
  }
  return port
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  }
  catch {
    return false
  }
}

async function readBundleValue(appPath, key) {
  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist')
  const { stdout } = await execFileAsync('/usr/bin/plutil', [
    '-extract',
    key,
    'raw',
    '-o',
    '-',
    infoPlistPath,
  ])
  return stdout.trim()
}

async function resolveAppExecutable(appPath) {
  if (!appPath.endsWith('.app')) {
    throw new Error(`--old-app must point to a .app bundle: ${appPath}`)
  }

  const executableName = await readBundleValue(appPath, 'CFBundleExecutable')
  const executablePath = path.join(appPath, 'Contents', 'MacOS', executableName)
  if (!(await pathExists(executablePath))) {
    throw new Error(`App executable is missing: ${executablePath}`)
  }
  return executablePath
}

function createStaticServer(rootDir) {
  return http.createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400)
      response.end('Bad request')
      return
    }

    const requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1)
    const filePath = path.resolve(rootDir, relativePath)
    if (!filePath.startsWith(path.resolve(rootDir) + path.sep)) {
      response.writeHead(403)
      response.end('Forbidden')
      return
    }

    try {
      const body = await fs.readFile(filePath)
      response.writeHead(200, {
        'content-type': readContentType(filePath),
        'content-length': String(body.byteLength),
      })
      response.end(body)
    }
    catch {
      response.writeHead(404)
      response.end('Not found')
    }
  })
}

function readContentType(filePath) {
  if (filePath.endsWith('.json')) {
    return 'application/json'
  }
  if (filePath.endsWith('.zip')) {
    return 'application/zip'
  }
  return 'application/octet-stream'
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Could not read local update feed server address'))
        return
      }
      resolve(address.port)
    })
  })
}

async function generateManifest(input) {
  const args = [
    manifestScriptPath,
    '--base-url',
    input.baseUrl,
    '--artifact',
    input.newZip,
    '--out',
    path.join(input.feedDir, 'macos', 'manifest.json'),
    '--version',
    input.version,
  ]
  if (input.arch) {
    args.push('--arch', input.arch)
  }

  await execFileAsync(process.execPath, args, {
    cwd: desktopRoot,
  })
}

async function launchOldApp(input) {
  const executablePath = await resolveAppExecutable(input.oldApp)
  const child = spawn(executablePath, [], {
    detached: true,
    env: {
      ...process.env,
      CRADLE_DESKTOP_UPDATE_URL: input.baseUrl,
    },
    stdio: 'ignore',
  })
  child.unref()
  return executablePath
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Desktop update smoke is only available on macOS.')
  }

  const options = parseArgs(process.argv.slice(2))
  if (!(await pathExists(options.newZip))) {
    throw new Error(`Update zip is missing: ${options.newZip}`)
  }
  if (options.oldApp && !(await pathExists(options.oldApp))) {
    throw new Error(`Old app bundle is missing: ${options.oldApp}`)
  }

  const tempFeedDir = options.feedDir
    ? null
    : await fs.mkdtemp(path.join(os.tmpdir(), 'cradle-update-feed-'))
  const feedDir = options.feedDir ?? tempFeedDir
  await fs.mkdir(feedDir, { recursive: true })

  const server = createStaticServer(feedDir)
  const port = await listen(server, options.port)
  const baseUrl = `http://127.0.0.1:${port}`
  await generateManifest({
    arch: options.arch,
    baseUrl,
    feedDir,
    newZip: options.newZip,
    version: options.version,
  })

  console.log(`Update feed: ${baseUrl}`)
  console.log(`Manifest: ${path.join(feedDir, 'macos', 'manifest.json')}`)
  console.log(`Zip: ${path.join(feedDir, 'macos', path.basename(options.newZip))}`)

  if (options.launch && options.oldApp) {
    const executablePath = await launchOldApp({
      baseUrl,
      oldApp: options.oldApp,
    })
    console.log(`Launched old app: ${executablePath}`)
  }
  else if (options.oldApp) {
    const executablePath = await resolveAppExecutable(options.oldApp)
    console.log('Launch command:')
    console.log(`CRADLE_DESKTOP_UPDATE_URL=${baseUrl} ${executablePath}`)
  }

  console.log('Keep this process running while the app checks and downloads the update.')
  console.log('After Restart completes, inspect ~/Library/Application Support/Cradle/updates/last-update-result.json')

  const stop = async () => {
    await new Promise(resolve => server.close(resolve))
    if (tempFeedDir && !options.keepFeed) {
      await fs.rm(tempFeedDir, { recursive: true, force: true })
    }
  }

  process.once('SIGINT', async () => {
    await stop()
    process.exit(0)
  })
  process.once('SIGTERM', async () => {
    await stop()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
