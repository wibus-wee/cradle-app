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
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
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
const electronBuilderArchNames = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal'],
])

const supportedTargets = new Map([
  ['darwin-arm64', {
    platform: 'darwin',
    arch: 'arm64',
    triple: 'aarch64-apple-darwin',
    assetName: 'codex-aarch64-apple-darwin.tar.gz',
    executableName: 'codex',
  }],
  ['darwin-x64', {
    platform: 'darwin',
    arch: 'x64',
    triple: 'x86_64-apple-darwin',
    assetName: 'codex-x86_64-apple-darwin.tar.gz',
    executableName: 'codex',
  }],
  ['linux-arm64', {
    platform: 'linux',
    arch: 'arm64',
    triple: 'aarch64-unknown-linux-musl',
    assetName: 'codex-aarch64-unknown-linux-musl.tar.gz',
    executableName: 'codex',
  }],
  ['linux-x64', {
    platform: 'linux',
    arch: 'x64',
    triple: 'x86_64-unknown-linux-musl',
    assetName: 'codex-x86_64-unknown-linux-musl.tar.gz',
    executableName: 'codex',
  }],
  ['win32-arm64', {
    platform: 'win32',
    arch: 'arm64',
    triple: 'aarch64-pc-windows-msvc',
    assetName: 'codex-aarch64-pc-windows-msvc.exe.tar.gz',
    executableName: 'codex.exe',
  }],
  ['win32-x64', {
    platform: 'win32',
    arch: 'x64',
    triple: 'x86_64-pc-windows-msvc',
    assetName: 'codex-x86_64-pc-windows-msvc.exe.tar.gz',
    executableName: 'codex.exe',
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

export function normalizeElectronBuilderArch(arch) {
  if (typeof arch === 'string') {
    return normalizeArch(arch)
  }
  const name = electronBuilderArchNames.get(arch)
  if (!name) {
    throw new Error(`Unsupported electron-builder arch: ${String(arch)}`)
  }
  return normalizeArch(name)
}

export function getCodexRuntimePath(targetInput = {}) {
  const target = resolveCodexRuntimeTarget(targetInput)
  return join(codexResourceRoot, `${target.platform}-${target.arch}`, target.executableName)
}

export async function ensureCodexRuntime(input = {}) {
  const target = resolveCodexRuntimeTarget(input)
  const releaseTag = input.releaseTag ?? defaultReleaseTag
  const release = await fetchCodexRelease(releaseTag)
  const asset = findReleaseAsset(release, target.assetName)
  const outputDir = join(codexResourceRoot, `${target.platform}-${target.arch}`)
  const executablePath = join(outputDir, target.executableName)
  const manifestPath = join(outputDir, 'codex-runtime.json')

  if (!input.force && await isExistingRuntimeCurrent({
    executablePath,
    manifestPath,
    release,
    asset,
    target,
  })) {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    return { target, release, asset, executablePath, manifestPath, manifest }
  }

  await mkdir(outputDir, { recursive: true })
  const tempDir = await mkdtemp(join(tmpdir(), 'cradle-codex-runtime-'))
  try {
    const archivePath = join(tempDir, target.assetName)
    const extractDir = join(tempDir, 'extract')
    await mkdir(extractDir, { recursive: true })
    await downloadFile(asset.browser_download_url, archivePath)
    await tar.x({ file: archivePath, cwd: extractDir })

    const extractedExecutable = await findExtractedCodexExecutable(extractDir, target)
    await copyFile(extractedExecutable, executablePath)
    if (target.platform !== 'win32') {
      await chmod(executablePath, 0o755)
    }

    const binary = await readBinaryMetadata(executablePath, target)
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
      binary,
      updatedAt: new Date().toISOString(),
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    return { target, release, asset, executablePath, manifestPath, manifest }
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export async function copyCodexRuntimeToPackagedResources(context, input = {}) {
  const platform = normalizePlatform(context.electronPlatformName)
  const arch = normalizeElectronBuilderArch(context.arch)
  const runtime = await ensureCodexRuntime({
    platform,
    arch,
    releaseTag: input.releaseTag,
    force: input.force,
  })
  const resourcesDir = resolvePackagedResourcesDir(context, platform)
  const destination = join(resourcesDir, runtime.target.executableName)
  await mkdir(resourcesDir, { recursive: true })
  await copyFile(runtime.executablePath, destination)
  if (runtime.target.platform !== 'win32') {
    await chmod(destination, 0o755)
  }
  console.warn(`[desktop] Bundled Codex runtime ${runtime.manifest.release.tagName} ${platform}-${arch} at ${destination}`)
  return { ...runtime, destination }
}

export function resolvePackagedResourcesDir(context, platform = normalizePlatform(context.electronPlatformName)) {
  if (platform === 'darwin') {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
    )
  }
  return join(context.appOutDir, 'resources')
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

async function isExistingRuntimeCurrent(input) {
  try {
    const [manifest, executableStats] = await Promise.all([
      readFile(input.manifestPath, 'utf8').then(value => JSON.parse(value)),
      stat(input.executablePath),
    ])
    return executableStats.isFile()
      && manifest?.source === githubSource
      && manifest?.release?.tagName === input.release.tag_name
      && manifest?.asset?.name === input.asset.name
      && manifest?.target?.platform === input.target.platform
      && manifest?.target?.arch === input.target.arch
  }
  catch {
    return false
  }
}

async function fetchCodexRelease(releaseTag) {
  const url = releaseTag === 'latest'
    ? `${githubApiBase}/latest`
    : `${githubApiBase}/tags/${encodeURIComponent(releaseTag)}`
  const response = await fetch(url, { headers: githubHeaders() })
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
  const response = await fetch(url, { headers: githubHeaders() })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
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

async function findExtractedCodexExecutable(rootDir, target) {
  const files = await collectFiles(rootDir)
  const basenames = [
    target.executableName,
    `codex-${target.triple}`,
    target.platform === 'win32' ? `codex-${target.triple}.exe` : null,
  ].filter(Boolean)
  for (const wanted of basenames) {
    const match = files.find(file => path.basename(file) === wanted)
    if (match) {
      return match
    }
  }

  const fallback = files.find((file) => {
    const base = path.basename(file)
    return target.platform === 'win32'
      ? base.startsWith('codex') && base.endsWith('.exe')
      : base.startsWith('codex') && !base.includes('.')
  })
  if (fallback) {
    return fallback
  }

  throw new Error(`Codex runtime archive did not contain ${target.executableName}`)
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
    path: target.executableName,
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
    results.push(result)
    console.log(`${result.manifest.release.tagName} ${result.target.platform}-${result.target.arch} -> ${result.executablePath}`)
  }
  return results
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
