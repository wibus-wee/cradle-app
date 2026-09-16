import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDir, '..')
const codexRoot = resolve(serverRoot, 'src/modules/chat-runtime-providers/codex')
const protocolManifestPath = resolve(codexRoot, 'app-server-protocol/MANIFEST.json')
const manifestPath = resolve(codexRoot, 'codex-runtime-manifest.json')
const checkOnly = process.argv.includes('--check')

const targets = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

const protocolManifest = JSON.parse(await readFile(protocolManifestPath, 'utf8'))
const sdkVersion = typeof protocolManifest.generatorVersion === 'string'
  ? protocolManifest.generatorVersion.match(/codex-cli\s+(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)?.[1]
  : null
if (!sdkVersion) {
  throw new Error(`Codex app-server protocol manifest has an unrecognized generatorVersion: ${String(protocolManifest.generatorVersion)}`)
}

const releaseTag = `rust-v${sdkVersion}`
const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
const response = await fetch(`https://api.github.com/repos/openai/codex/releases/tags/${releaseTag}`, {
  headers: {
    'accept': 'application/vnd.github+json',
    'user-agent': 'cradle-codex-runtime-manifest',
    ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
  },
})
if (!response.ok) {
  throw new Error(`Codex release metadata request failed: ${response.status}`)
}
const release = await response.json()
const assetsByName = new Map(release.assets.map(asset => [asset.name, asset]))

function resolveAsset(binaryStem, triple, windows) {
  const assetName = `codex-${binaryStem}-${triple}${windows ? '.exe' : ''}.tar.gz`
  const asset = assetsByName.get(assetName)
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`Codex release asset is missing or has invalid size: ${assetName}`)
  }
  const digest = typeof asset.digest === 'string' ? asset.digest.match(/^sha256:([a-f0-9]{64})$/)?.[1] : undefined
  if (!digest) {
    throw new Error(`Codex release asset has no valid SHA-256 digest: ${assetName}`)
  }
  return {
    assetName,
    format: 'tar.gz',
    sizeBytes: asset.size,
    sha256: digest,
  }
}

const resolvedTargets = {}
for (const [key, triple] of Object.entries(targets)) {
  const windows = key.startsWith('win32-')
  resolvedTargets[key] = {
    appServer: resolveAsset('app-server', triple, windows),
    codeModeHost: resolveAsset('code-mode-host', triple, windows),
  }
}

const manifest = {
  schemaVersion: 1,
  sdkVersion,
  releaseTag,
  repository: 'openai/codex',
  targets: resolvedTargets,
}
const serialized = `${JSON.stringify(manifest, null, 2)}\n`
if (checkOnly) {
  const current = await readFile(manifestPath, 'utf8')
  if (current !== serialized) {
    throw new Error('Codex runtime manifest is not synchronized with the vendored app-server protocol version.')
  }
}
else {
  await writeFile(manifestPath, serialized, 'utf8')
}
