import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path, { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import * as tar from 'tar'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDir, '..')
const codexResourceRoot = join(desktopRoot, 'resources', 'codex')
const githubApiBase = 'https://api.github.com/repos/openai/codex/releases'
const githubSource = 'github:openai/codex'
const defaultReleaseTag = process.env.CRADLE_CODEX_RELEASE_TAG?.trim() || 'latest'

const supportedTargets = new Map([
  ['darwin-arm64', {
    platform: 'darwin',
    arch: 'arm64',
    triple: 'aarch64-apple-darwin',
    assetName: 'codex-aarch64-apple-darwin.tar.gz',
    executableName: 'codex',
    appServerAssetName: 'codex-app-server-aarch64-apple-darwin.tar.gz',
    appServerExecutableName: 'codex-app-server',
    codeModeHostAssetName: 'codex-code-mode-host-aarch64-apple-darwin.tar.gz',
    codeModeHostExecutableName: 'codex-code-mode-host',
  }],
  ['darwin-x64', {
    platform: 'darwin',
    arch: 'x64',
    triple: 'x86_64-apple-darwin',
    assetName: 'codex-x86_64-apple-darwin.tar.gz',
    executableName: 'codex',
    appServerAssetName: 'codex-app-server-x86_64-apple-darwin.tar.gz',
    appServerExecutableName: 'codex-app-server',
    codeModeHostAssetName: 'codex-code-mode-host-x86_64-apple-darwin.tar.gz',
    codeModeHostExecutableName: 'codex-code-mode-host',
  }],
  ['linux-arm64', {
    platform: 'linux',
    arch: 'arm64',
    triple: 'aarch64-unknown-linux-musl',
    assetName: 'codex-aarch64-unknown-linux-musl.tar.gz',
    executableName: 'codex',
    appServerAssetName: 'codex-app-server-aarch64-unknown-linux-musl.tar.gz',
    appServerExecutableName: 'codex-app-server',
    codeModeHostAssetName: 'codex-code-mode-host-aarch64-unknown-linux-musl.tar.gz',
    codeModeHostExecutableName: 'codex-code-mode-host',
  }],
  ['linux-x64', {
    platform: 'linux',
    arch: 'x64',
    triple: 'x86_64-unknown-linux-musl',
    assetName: 'codex-x86_64-unknown-linux-musl.tar.gz',
    executableName: 'codex',
    appServerAssetName: 'codex-app-server-x86_64-unknown-linux-musl.tar.gz',
    appServerExecutableName: 'codex-app-server',
    codeModeHostAssetName: 'codex-code-mode-host-x86_64-unknown-linux-musl.tar.gz',
    codeModeHostExecutableName: 'codex-code-mode-host',
  }],
  ['win32-arm64', {
    platform: 'win32',
    arch: 'arm64',
    triple: 'aarch64-pc-windows-msvc',
    assetName: 'codex-aarch64-pc-windows-msvc.exe.tar.gz',
    executableName: 'codex.exe',
    appServerAssetName: 'codex-app-server-aarch64-pc-windows-msvc.exe.tar.gz',
    appServerExecutableName: 'codex-app-server.exe',
    codeModeHostAssetName: 'codex-code-mode-host-aarch64-pc-windows-msvc.exe.tar.gz',
    codeModeHostExecutableName: 'codex-code-mode-host.exe',
  }],
  ['win32-x64', {
    platform: 'win32',
    arch: 'x64',
    triple: 'x86_64-pc-windows-msvc',
    assetName: 'codex-x86_64-pc-windows-msvc.exe.tar.gz',
    executableName: 'codex.exe',
    appServerAssetName: 'codex-app-server-x86_64-pc-windows-msvc.exe.tar.gz',
    appServerExecutableName: 'codex-app-server.exe',
    codeModeHostAssetName: 'codex-code-mode-host-x86_64-pc-windows-msvc.exe.tar.gz',
    codeModeHostExecutableName: 'codex-code-mode-host.exe',
  }],
])

export function getCurrentCodexRuntimeTarget() {
  return resolveCodexRuntimeTarget({
    platform: process.platform,
    arch: process.arch,
  })
}

export function resolveCodexRuntimeTarget(input = {}) {
  const platform = normalizePlatform(input.platform ?? process.platform)
  const arch = normalizeArch(input.arch ?? process.arch)
  const target = supportedTargets.get(`${platform}-${arch}`)
  if (!target) {
    throw new Error(`Unsupported Codex runtime target: ${platform}-${arch}`)
  }
  return target
}

export function getCodexRuntimePath(targetInput = {}) {
  const target = resolveCodexRuntimeTarget(targetInput)
  return join(codexResourceRoot, `${target.platform}-${target.arch}`, target.executableName)
}

export function getCodexAppServerRuntimePath(targetInput = {}) {
  const target = resolveCodexRuntimeTarget(targetInput)
  return join(codexResourceRoot, `${target.platform}-${target.arch}`, target.appServerExecutableName)
}

export function getCodexCodeModeHostRuntimePath(targetInput = {}) {
  const target = resolveCodexRuntimeTarget(targetInput)
  return join(codexResourceRoot, `${target.platform}-${target.arch}`, target.codeModeHostExecutableName)
}

export async function ensureCodexRuntime(input = {}) {
  const target = resolveCodexRuntimeTarget(input)
  const releaseTag = input.releaseTag ?? defaultReleaseTag
  const release = await fetchCodexRelease(releaseTag)
  const asset = findReleaseAsset(release, target.assetName)
  const appServerAsset = findReleaseAsset(release, target.appServerAssetName)
  const codeModeHostAsset = findReleaseAsset(release, target.codeModeHostAssetName)
  const outputDir = join(codexResourceRoot, `${target.platform}-${target.arch}`)
  const executablePath = join(outputDir, target.executableName)
  const appServerExecutablePath = join(outputDir, target.appServerExecutableName)
  const codeModeHostExecutablePath = join(outputDir, target.codeModeHostExecutableName)
  const manifestPath = join(outputDir, 'codex-runtime.json')
  const existingManifest = await readRuntimeManifest(manifestPath)
  const runtimeIsCurrent = !input.force && await isExistingArtifactCurrent({
    executablePath,
    manifest: existingManifest,
    release,
    asset,
    assetManifestKey: 'asset',
    target,
  })
  const appServerIsCurrent = !input.force && await isExistingArtifactCurrent({
    executablePath: appServerExecutablePath,
    manifest: existingManifest,
    release,
    asset: appServerAsset,
    assetManifestKey: 'appServerAsset',
    target,
  })
  const codeModeHostIsCurrent = !input.force && await isExistingArtifactCurrent({
    executablePath: codeModeHostExecutablePath,
    manifest: existingManifest,
    release,
    asset: codeModeHostAsset,
    assetManifestKey: 'codeModeHostAsset',
    target,
  })

  if (runtimeIsCurrent && appServerIsCurrent && codeModeHostIsCurrent) {
    return {
      target,
      release,
      asset,
      appServerAsset,
      codeModeHostAsset,
      executablePath,
      appServerExecutablePath,
      codeModeHostExecutablePath,
      manifestPath,
      manifest: existingManifest,
    }
  }

  await mkdir(outputDir, { recursive: true })
  const tempDir = await mkdtemp(join(tmpdir(), 'cradle-codex-runtime-'))
  try {
    await Promise.all([
      runtimeIsCurrent
        ? Promise.resolve()
        : downloadAndInstallExecutable({
            asset,
            tempDir: join(tempDir, 'codex'),
            executableNames: [
              target.executableName,
              `codex-${target.triple}`,
              target.platform === 'win32' ? `codex-${target.triple}.exe` : null,
            ].filter(Boolean),
            executablePath,
            target,
          }),
      appServerIsCurrent
        ? Promise.resolve()
        : downloadAndInstallExecutable({
            asset: appServerAsset,
            tempDir: join(tempDir, 'app-server'),
            executableNames: [
              target.appServerExecutableName,
              `codex-app-server-${target.triple}`,
              target.platform === 'win32' ? `codex-app-server-${target.triple}.exe` : null,
            ].filter(Boolean),
            executablePath: appServerExecutablePath,
            target,
          }),
      codeModeHostIsCurrent
        ? Promise.resolve()
        : downloadAndInstallExecutable({
            asset: codeModeHostAsset,
            tempDir: join(tempDir, 'code-mode-host'),
            executableNames: [
              target.codeModeHostExecutableName,
              `codex-code-mode-host-${target.triple}`,
              target.platform === 'win32' ? `codex-code-mode-host-${target.triple}.exe` : null,
            ].filter(Boolean),
            executablePath: codeModeHostExecutablePath,
            target,
          }),
    ])

    const [binary, appServerBinary, codeModeHostBinary] = await Promise.all([
      readBinaryMetadata(executablePath, target),
      readBinaryMetadata(appServerExecutablePath, target),
      readBinaryMetadata(codeModeHostExecutablePath, target),
    ])
    const manifest = {
      kind: 'cradle.codex-runtime',
      source: githubSource,
      release: {
        tagName: release.tag_name,
        name: release.name ?? null,
        htmlUrl: release.html_url,
        publishedAt: release.published_at,
      },
      target: {
        platform: target.platform,
        arch: target.arch,
        triple: target.triple,
      },
      asset: {
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size ?? null,
        digest: asset.digest ?? null,
      },
      appServerAsset: {
        name: appServerAsset.name,
        url: appServerAsset.browser_download_url,
        size: appServerAsset.size ?? null,
        digest: appServerAsset.digest ?? null,
      },
      codeModeHostAsset: {
        name: codeModeHostAsset.name,
        url: codeModeHostAsset.browser_download_url,
        size: codeModeHostAsset.size ?? null,
        digest: codeModeHostAsset.digest ?? null,
      },
      binary,
      appServerBinary,
      codeModeHostBinary,
      updatedAt: new Date().toISOString(),
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    return {
      target,
      release,
      asset,
      appServerAsset,
      codeModeHostAsset,
      executablePath,
      appServerExecutablePath,
      codeModeHostExecutablePath,
      manifestPath,
      manifest,
    }
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function installExecutableAtomically(source, destination, target) {
  const stagedPath = `${destination}.staged-${process.pid}-${Date.now()}`
  try {
    await copyFile(source, stagedPath)
    if (target.platform !== 'win32') {
      await chmod(stagedPath, 0o755)
    }
    await rename(stagedPath, destination)
  }
  finally {
    await rm(stagedPath, { force: true })
  }
}

/**
 * Mirror of `resolveCodexAppServerHome` in the server runtime — kept in sync so
 * `--managed` writes into the same root the managed-installation service reads.
 */
export function resolveCodexManagedRoot(env = process.env, homeDir = homedir()) {
  const dataDir = env.CRADLE_DATA_DIR?.trim()
  if (dataDir) {
    return join(dataDir, 'runtimes', 'codex-app-server', 'managed')
  }
  const dbPath = env.CRADLE_DB_PATH?.trim()
  if (dbPath) {
    return join(dirname(dbPath), 'runtimes', 'codex-app-server', 'managed')
  }
  return join(homeDir, '.cradle', 'runtimes', 'codex-app-server', 'managed')
}

function readAssetSha256(digest) {
  const sha256 = typeof digest === 'string' ? digest.match(/^sha256:([a-f0-9]{64})$/)?.[1] : null
  if (!sha256) {
    throw new Error(`Codex release asset has no valid SHA-256 digest: ${String(digest)}`)
  }
  return sha256
}

/**
 * Materialize the downloaded binaries into the managed-installation layout the
 * server resolves at runtime (`versions/<version>/bin`, `installation.json`,
 * `current.json`). Only valid for the host platform target.
 */
export async function materializeManagedCodexInstallation(runtime) {
  const targetKey = `${runtime.target.platform}-${runtime.target.arch}`
  if (targetKey !== `${process.platform}-${normalizeArch(process.arch)}`) {
    throw new Error(`--managed only supports the host target; got ${targetKey}`)
  }
  const version = runtime.manifest.release.tagName.match(/^rust-v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/)?.[1]
  if (!version) {
    throw new Error(`Cannot derive a Codex SDK version from release tag ${runtime.manifest.release.tagName}`)
  }
  const rootDir = resolveCodexManagedRoot()
  const binDir = join(rootDir, 'versions', version, 'bin')
  await mkdir(binDir, { recursive: true })
  const appServerPath = join(binDir, runtime.target.appServerExecutableName)
  const codeModeHostPath = join(binDir, runtime.target.codeModeHostExecutableName)
  await Promise.all([
    copyFile(runtime.appServerExecutablePath, appServerPath),
    copyFile(runtime.codeModeHostExecutablePath, codeModeHostPath),
  ])
  if (runtime.target.platform !== 'win32') {
    await Promise.all([
      chmod(appServerPath, 0o755),
      chmod(codeModeHostPath, 0o755),
    ])
  }
  const manifest = {
    schemaVersion: 1,
    version,
    releaseTag: runtime.manifest.release.tagName,
    targetKey,
    appServerPath: join('versions', version, 'bin', runtime.target.appServerExecutableName),
    codeModeHostPath: join('versions', version, 'bin', runtime.target.codeModeHostExecutableName),
    sha256: {
      appServer: readAssetSha256(runtime.appServerAsset.digest),
      codeModeHost: readAssetSha256(runtime.codeModeHostAsset.digest),
    },
    installedAt: new Date().toISOString(),
  }
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(join(rootDir, 'versions', version, 'installation.json'), serialized, 'utf8')
  await writeFile(join(rootDir, 'current.json'), serialized, 'utf8')
  console.warn(`[desktop] Installed managed Codex runtime ${version} (${targetKey}) at ${rootDir}`)
  return { rootDir, version, appServerPath, codeModeHostPath }
}

export async function readCodexRuntimeVersion(executablePath) {
  return new Promise((resolve) => {
    execFile(executablePath, ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
    }, (_error, stdout) => {
      resolve(stdout.trim() || null)
    })
  })
}

async function readRuntimeManifest(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'))
  }
  catch {
    return null
  }
}

async function isExistingArtifactCurrent(input) {
  try {
    const executableStats = await stat(input.executablePath)
    return executableStats.isFile()
      && input.manifest?.source === githubSource
      && input.manifest?.release?.tagName === input.release.tag_name
      && input.manifest?.[input.assetManifestKey]?.name === input.asset.name
      && input.manifest?.target?.platform === input.target.platform
      && input.manifest?.target?.arch === input.target.arch
  }
  catch {
    return false
  }
}

async function fetchCodexRelease(releaseTag) {
  const url = releaseTag === 'latest'
    ? `${githubApiBase}/latest`
    : `${githubApiBase}/tags/${encodeURIComponent(releaseTag)}`
  const response = await fetchWithRetry(url, { headers: githubHeaders() })
  if (!response.ok) {
    throw new Error(`Failed to read Codex release ${releaseTag}: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

function findReleaseAsset(release, assetName) {
  const asset = release.assets?.find(item => item.name === assetName)
  if (!asset?.browser_download_url) {
    throw new Error(`Codex release ${release.tag_name} does not include asset ${assetName}`)
  }
  return asset
}

async function downloadFile(url, destination) {
  let lastError
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const downloadedBytes = await stat(destination).then(value => value.size).catch(() => 0)
    try {
      const response = await fetchWithRetry(url, {
        headers: {
          ...githubHeaders(),
          ...(downloadedBytes > 0 ? { Range: `bytes=${downloadedBytes}-` } : {}),
        },
      })
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
      }
      const append = downloadedBytes > 0 && response.status === 206
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(destination, { flags: append ? 'a' : 'w' }),
      )
      return
    }
    catch (error) {
      lastError = error
      if (attempt < 5) {
        await new Promise(resolve => setTimeout(resolve, attempt * 750))
      }
    }
  }
  throw lastError
}

async function fetchWithRetry(url, init, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init)
      if (response.status < 500 && response.status !== 429) {
        return response
      }
      lastError = new Error(`Request failed with ${response.status} ${response.statusText}`)
      await response.body?.cancel()
    }
    catch (error) {
      lastError = error
    }
    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, attempt * 750))
    }
  }
  throw lastError
}

function githubHeaders() {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'cradle-codex-runtime-sync',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN?.trim()
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

async function downloadAndExtractExecutable(input) {
  const archivePath = join(input.tempDir, input.asset.name)
  const extractDir = join(input.tempDir, 'extract')
  await mkdir(extractDir, { recursive: true })
  await downloadFile(input.asset.browser_download_url, archivePath)
  await tar.x({ file: archivePath, cwd: extractDir })

  const files = await collectFiles(extractDir)
  for (const wanted of input.executableNames) {
    const match = files.find(file => path.basename(file) === wanted)
    if (match) {
      return match
    }
  }
  throw new Error(
    `Codex release asset ${input.asset.name} did not contain any of: ${input.executableNames.join(', ')}`,
  )
}

async function downloadAndInstallExecutable(input) {
  const extractedExecutable = await downloadAndExtractExecutable(input)
  await installExecutableAtomically(extractedExecutable, input.executablePath, input.target)
}

async function collectFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath))
    }
    else if (entry.isFile()) {
      files.push(entryPath)
    }
  }
  return files
}

async function readBinaryMetadata(executablePath, target) {
  const bytes = await readFile(executablePath)
  const version = target.platform === process.platform && target.arch === normalizeArch(process.arch)
    ? await readCodexRuntimeVersion(executablePath)
    : null
  return {
    path: path.basename(executablePath),
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    version,
  }
}

function normalizePlatform(value) {
  switch (value) {
    case 'darwin':
    case 'mac':
    case 'mas':
      return 'darwin'
    case 'win':
    case 'windows':
    case 'win32':
      return 'win32'
    case 'linux':
      return 'linux'
    default:
      throw new Error(`Unsupported Codex runtime platform: ${value}`)
  }
}

function normalizeArch(value) {
  switch (value) {
    case 'x64':
    case 'amd64':
    case 'x86_64':
      return 'x64'
    case 'arm64':
    case 'aarch64':
      return 'arm64'
    default:
      throw new Error(`Unsupported Codex runtime arch: ${value}`)
  }
}

function parseCliArgs(argv) {
  const options = {
    current: false,
    all: false,
    force: false,
    managed: false,
    releaseTag: defaultReleaseTag,
    targets: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--current') {
      options.current = true
    }
    else if (arg === '--all') {
      options.all = true
    }
    else if (arg === '--managed') {
      options.managed = true
    }
    else if (arg === '--force') {
      options.force = true
    }
    else if (arg === '--version' || arg === '--tag') {
      options.releaseTag = readRequiredArg(argv, index, arg)
      index += 1
    }
    else if (arg.startsWith('--version=')) {
      options.releaseTag = arg.slice('--version='.length)
    }
    else if (arg.startsWith('--tag=')) {
      options.releaseTag = arg.slice('--tag='.length)
    }
    else if (arg === '--target') {
      options.targets.push(...readRequiredArg(argv, index, arg).split(','))
      index += 1
    }
    else if (arg.startsWith('--target=')) {
      options.targets.push(...arg.slice('--target='.length).split(','))
    }
    else if (arg === '--targets') {
      options.targets.push(...readRequiredArg(argv, index, arg).split(','))
      index += 1
    }
    else if (arg.startsWith('--targets=')) {
      options.targets.push(...arg.slice('--targets='.length).split(','))
    }
    else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function readRequiredArg(argv, index, flag) {
  const value = argv[index + 1]
  if (!value) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function targetsFromCliOptions(options) {
  if (options.all) {
    return [...supportedTargets.keys()]
  }
  if (options.targets.length > 0) {
    return options.targets.map(value => value.trim()).filter(Boolean)
  }
  return [`${process.platform}-${normalizeArch(process.arch)}`]
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2))
  const results = []
  for (const targetKey of targetsFromCliOptions(options)) {
    const [platform, arch] = targetKey.split('-')
    const result = await ensureCodexRuntime({
      platform,
      arch,
      releaseTag: options.releaseTag,
      force: options.force,
    })
    if (options.managed) {
      await materializeManagedCodexInstallation(result)
    }
    results.push(result)
    console.log(
      `${result.manifest.release.tagName} ${result.target.platform}-${result.target.arch} -> ${result.executablePath}, ${result.appServerExecutablePath}, ${result.codeModeHostExecutablePath}`,
    )
  }
  return results
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
