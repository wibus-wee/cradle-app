import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDir, '..')
const claudeAgentRoot = resolve(serverRoot, 'src/modules/chat-runtime-providers/claude-agent')
const serverPackageJsonPath = resolve(serverRoot, 'package.json')
const sdkPackageJsonPath = resolve(serverRoot, 'node_modules/@anthropic-ai/claude-agent-sdk/package.json')
const manifestPath = resolve(claudeAgentRoot, 'claude-code-runtime-manifest.json')
const checkOnly = process.argv.includes('--check')

const registry = (process.env.CRADLE_NPM_REGISTRY ?? 'https://registry.npmjs.org').replace(/\/$/, '')
const sdkPackageScope = '@anthropic-ai'
const sdkPackageName = 'claude-agent-sdk'

const serverPackageJson = JSON.parse(await readFile(serverPackageJsonPath, 'utf8'))
const declaredSdkSpec = serverPackageJson.dependencies?.[`${sdkPackageScope}/${sdkPackageName}`]
if (typeof declaredSdkSpec !== 'string' || !/^\d+\.\d+\.\d+/.test(declaredSdkSpec.trim())) {
  throw new Error(`@anthropic-ai/claude-agent-sdk must be pinned to an exact version in apps/server/package.json; found: ${String(declaredSdkSpec)}`)
}
const sdkVersion = declaredSdkSpec.trim()

const sdkPackageJson = JSON.parse(await readFile(sdkPackageJsonPath, 'utf8'))
if (sdkPackageJson.version !== sdkVersion) {
  throw new Error(`Installed @anthropic-ai/claude-agent-sdk ${sdkPackageJson.version} does not match the pinned ${sdkVersion}. Run pnpm install first.`)
}
const platformPackages = Object.keys(sdkPackageJson.optionalDependencies ?? {})
  .filter(name => name.startsWith(`${sdkPackageScope}/${sdkPackageName}-`))
  .sort()
if (platformPackages.length === 0) {
  throw new Error('@anthropic-ai/claude-agent-sdk declares no platform optional dependencies to mirror.')
}

function integrityToSha512Hex(integrity) {
  const match = typeof integrity === 'string' ? integrity.match(/^sha512-([A-Za-z0-9+/=]+)$/) : null
  if (!match) {
    return null
  }
  return Buffer.from(match[1], 'base64').toString('hex')
}

async function resolvePlatformPackage(packageName) {
  const encodedName = packageName.replace('/', '%2f')
  const response = await fetch(`${registry}/${encodedName}`, {
    headers: { 'accept': 'application/json', 'user-agent': 'cradle-claude-runtime-manifest' },
  })
  if (!response.ok) {
    throw new Error(`npm packument request failed for ${packageName}: ${response.status}`)
  }
  const packument = await response.json()
  const versionMeta = packument.versions?.[sdkVersion]
  if (!versionMeta) {
    throw new Error(`${packageName} has no published version ${sdkVersion} to match the SDK.`)
  }
  const dist = versionMeta.dist ?? {}
  if (typeof dist.tarball !== 'string' || !dist.tarball.startsWith('https://')) {
    throw new Error(`${packageName}@${sdkVersion} has no https tarball URL.`)
  }
  const sha512 = integrityToSha512Hex(dist.integrity)
  if (!sha512) {
    throw new Error(`${packageName}@${sdkVersion} has no sha512 integrity digest.`)
  }
  if (!Number.isSafeInteger(dist.unpackedSize) || dist.unpackedSize <= 0) {
    throw new Error(`${packageName}@${sdkVersion} has no valid unpackedSize.`)
  }
  return {
    packageName,
    tarball: dist.tarball,
    unpackedSizeBytes: dist.unpackedSize,
    sha512,
  }
}

const resolvedTargets = {}
for (const packageName of platformPackages) {
  const targetKey = packageName.slice(`${sdkPackageScope}/${sdkPackageName}-`.length)
  resolvedTargets[targetKey] = await resolvePlatformPackage(packageName)
}

const manifest = {
  schemaVersion: 1,
  sdkVersion,
  registry,
  targets: resolvedTargets,
}
const serialized = `${JSON.stringify(manifest, null, 2)}\n`
if (checkOnly) {
  const current = await readFile(manifestPath, 'utf8')
  if (current !== serialized) {
    throw new Error('Claude Code runtime manifest is not synchronized with the pinned @anthropic-ai/claude-agent-sdk version.')
  }
}
else {
  await writeFile(manifestPath, serialized, 'utf8')
}
