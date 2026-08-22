import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(scriptDir, '..')
const manifestPath = resolve(serverRoot, 'src/modules/chat-runtime-providers/opencode/opencode-runtime-manifest.json')
const sdkPackagePath = resolve(serverRoot, 'node_modules/@opencode-ai/sdk/package.json')
const checkOnly = process.argv.includes('--check')

const targets = {
  'darwin-arm64': ['opencode-darwin-arm64.zip', 'zip'],
  'darwin-x64': ['opencode-darwin-x64-baseline.zip', 'zip'],
  'linux-arm64-glibc': ['opencode-linux-arm64.tar.gz', 'tar.gz'],
  'linux-arm64-musl': ['opencode-linux-arm64-musl.tar.gz', 'tar.gz'],
  'linux-x64-glibc': ['opencode-linux-x64-baseline.tar.gz', 'tar.gz'],
  'linux-x64-musl': ['opencode-linux-x64-baseline-musl.tar.gz', 'tar.gz'],
  'win32-arm64': ['opencode-windows-arm64.zip', 'zip'],
  'win32-x64': ['opencode-windows-x64-baseline.zip', 'zip'],
}

const sdkPackage = JSON.parse(await readFile(sdkPackagePath, 'utf8'))
const version = sdkPackage.version
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error('Installed @opencode-ai/sdk package has an invalid version.')
}

const releaseTag = `v${version}`
const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
const response = await fetch(`https://api.github.com/repos/anomalyco/opencode/releases/tags/${releaseTag}`, {
  headers: {
    'accept': 'application/vnd.github+json',
    'user-agent': 'cradle-opencode-runtime-manifest',
    ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
  },
})
if (!response.ok) {
  throw new Error(`OpenCode release metadata request failed: ${response.status}`)
}
const release = await response.json()
const assetsByName = new Map(release.assets.map(asset => [asset.name, asset]))
const resolvedTargets = {}
for (const [key, [assetName, format]] of Object.entries(targets)) {
  const asset = assetsByName.get(assetName)
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`OpenCode release asset is missing or has invalid size: ${assetName}`)
  }
  const digest = typeof asset.digest === 'string' ? asset.digest.match(/^sha256:([a-f0-9]{64})$/)?.[1] : undefined
  if (!digest) {
    throw new Error(`OpenCode release asset has no valid SHA-256 digest: ${assetName}`)
  }
  resolvedTargets[key] = {
    assetName,
    format,
    sizeBytes: asset.size,
    sha256: digest,
  }
}

const manifest = {
  schemaVersion: 1,
  sdkVersion: version,
  releaseTag,
  repository: 'anomalyco/opencode',
  targets: resolvedTargets,
}
const serialized = `${JSON.stringify(manifest, null, 2)}\n`
if (checkOnly) {
  const current = await readFile(manifestPath, 'utf8')
  if (current !== serialized) {
    throw new Error('OpenCode runtime manifest is not synchronized with the installed SDK release.')
  }
}
else {
  await writeFile(manifestPath, serialized, 'utf8')
}
