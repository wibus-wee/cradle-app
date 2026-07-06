#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const relaydRoot = resolve(scriptDir, '..')
const repoRoot = resolve(relaydRoot, '../..')
const desktopResourcesRoot = resolve(repoRoot, 'apps/desktop/resources/relayd')

const target = parseTarget()
const executableName = target.platform === 'win32' ? 'relayd.exe' : 'relayd'
const targetDir = join(desktopResourcesRoot, `${target.platform}-${target.arch}`)
const tmpBinary = join(targetDir, `${executableName}.next`)
const outputBinary = join(targetDir, executableName)
const packageVersion = JSON.parse(readFileSync(join(relaydRoot, 'package.json'), 'utf8')).version

mkdirSync(targetDir, { recursive: true })
rmSync(tmpBinary, { force: true })

const result = spawnSync('go', [
  'build',
  '-trimpath',
  '-ldflags',
  `-X main.relaydVersion=${packageVersion}`,
  '-o',
  tmpBinary,
  './cmd/relayd',
], {
  cwd: relaydRoot,
  env: {
    ...process.env,
    CGO_ENABLED: '0',
    GOOS: goosForPlatform(target.platform),
    GOARCH: goarchForArch(target.arch),
  },
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}
if (result.status !== 0) {
  rmSync(tmpBinary, { force: true })
  process.exit(result.status ?? 1)
}

chmodSync(tmpBinary, 0o755)
renameSync(tmpBinary, outputBinary)

const version = readRelaydVersion(outputBinary) ?? packageVersion
const manifest = {
  kind: 'cradle.relayd-runtime',
  target,
  binary: {
    path: executableName,
    size: readFileSync(outputBinary).byteLength,
    sha256: sha256File(outputBinary),
    version,
  },
  updatedAt: new Date().toISOString(),
}
writeFileSync(join(targetDir, 'relayd-runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`Built relayd desktop resource at ${outputBinary}`)

function parseTarget() {
  const targetArg = process.argv.find(arg => arg.startsWith('--target='))
  if (!targetArg) {
    return { platform: process.platform, arch: process.arch }
  }
  const value = targetArg.slice('--target='.length)
  const [platform, arch] = value.split('-')
  if (!platform || !arch) {
    throw new Error(`Invalid --target value "${value}". Expected <platform>-<arch>.`)
  }
  return { platform, arch }
}

function goosForPlatform(platform) {
  switch (platform) {
    case 'darwin':
    case 'linux':
      return platform
    case 'win32':
      return 'windows'
    default:
      throw new Error(`Unsupported relayd desktop platform: ${platform}`)
  }
}

function goarchForArch(arch) {
  switch (arch) {
    case 'arm64':
      return 'arm64'
    case 'x64':
      return 'amd64'
    default:
      throw new Error(`Unsupported relayd desktop arch: ${arch}`)
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function readRelaydVersion(binaryPath) {
  if (!existsSync(binaryPath)) {
    return null
  }
  const result = spawnSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    timeout: 2_000,
  })
  if (result.status !== 0 || result.error) {
    return null
  }
  const version = result.stdout.trim()
  return version || null
}
