#!/usr/bin/env node
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDir, '..')

function printUsage() {
  console.log(`Usage: pnpm --filter @cradle/desktop generate-update-manifest -- --base-url <url> [options]

Options:
  --base-url <url>       Public update root URL. The manifest uses <url>/macos/<zip>.
  --artifact <path>      macOS zip artifact. Defaults to the single matching zip in release/.
  --arch <arch>          Artifact architecture: arm64, x64, or universal. Inferred from file name when possible.
  --out <path>           Manifest path. Defaults to release/update/macos/manifest.json.
  --release-name <name>  Release display name. Defaults to Cradle <version>.
  --release-notes <text> Release notes.
  --release-date <iso>   Release date. Defaults to the current time.
  --version <version>     Manifest version. Defaults to apps/desktop/package.json.
`)
}

function parseArgs(argv) {
  const options = {
    artifact: null,
    arch: null,
    baseUrl: process.env.CRADLE_DESKTOP_UPDATE_BASE_URL ?? null,
    out: path.resolve(desktopRoot, 'release/update/macos/manifest.json'),
    releaseDate: new Date().toISOString(),
    releaseName: null,
    releaseNotes: null,
    version: null,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }

    const value = argv[index + 1]
    switch (arg) {
      case '--artifact':
        options.artifact = path.resolve(desktopRoot, readOptionValue(arg, value))
        index++
        break
      case '--arch':
        options.arch = readOptionValue(arg, value)
        index++
        break
      case '--base-url':
        options.baseUrl = readOptionValue(arg, value)
        index++
        break
      case '--out':
        options.out = path.resolve(desktopRoot, readOptionValue(arg, value))
        index++
        break
      case '--release-date':
        options.releaseDate = readOptionValue(arg, value)
        index++
        break
      case '--release-name':
        options.releaseName = readOptionValue(arg, value)
        index++
        break
      case '--release-notes':
        options.releaseNotes = readOptionValue(arg, value)
        index++
        break
      case '--version':
        options.version = readOptionValue(arg, value)
        index++
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  if (!options.baseUrl) {
    throw new Error('--base-url is required')
  }

  return options
}

function readOptionValue(name, value) {
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

async function readPackageVersion() {
  const packageJson = JSON.parse(await fs.readFile(path.join(desktopRoot, 'package.json'), 'utf8'))
  return packageJson.version
}

async function selectArtifactPath(version, explicitPath) {
  if (explicitPath) {
    await fs.access(explicitPath)
    return explicitPath
  }

  const releaseDir = path.join(desktopRoot, 'release')
  const entries = await fs.readdir(releaseDir)
  const candidates = entries
    .filter(entry => entry.endsWith('.zip') && entry.includes(version))
    .map(entry => path.join(releaseDir, entry))

  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one macOS zip for ${version} in ${releaseDir}, found ${candidates.length}`)
  }

  return candidates[0]
}

async function readArtifactDigest(filePath) {
  const hash = createHash('sha256')
  const file = await fs.open(filePath, 'r')
  try {
    for await (const chunk of file.createReadStream()) {
      hash.update(chunk)
    }
  }
  finally {
    await file.close()
  }

  const stat = await fs.stat(filePath)
  return {
    sha256: hash.digest('hex'),
    size: stat.size,
  }
}

function readArtifactArch(filePath, explicitArch) {
  const arch = explicitArch ?? readArchFromName(path.basename(filePath))
  if (!arch) {
    throw new Error('Artifact architecture is required. Pass --arch arm64, --arch x64, or --arch universal.')
  }
  if (!['arm64', 'x64', 'universal'].includes(arch)) {
    throw new Error(`Unsupported macOS artifact architecture: ${arch}`)
  }
  return arch
}

function readArchFromName(fileName) {
  if (fileName.includes('arm64')) {
    return 'arm64'
  }
  if (fileName.includes('x64')) {
    return 'x64'
  }
  if (fileName.includes('universal')) {
    return 'universal'
  }
  return null
}

function joinUrl(...parts) {
  return parts
    .map((part, index) => {
      if (index === 0) {
        return part.replace(/\/+$/, '')
      }
      return part.replace(/^\/+|\/+$/g, '')
    })
    .filter(Boolean)
    .join('/')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const version = options.version ?? await readPackageVersion()
  const artifactPath = await selectArtifactPath(version, options.artifact)
  const outputDir = path.dirname(options.out)
  const artifactName = path.basename(artifactPath)
  const outputArtifactPath = path.join(outputDir, artifactName)
  const artifact = await readArtifactDigest(artifactPath)
  const arch = readArtifactArch(artifactPath, options.arch)

  await fs.mkdir(outputDir, { recursive: true })
  if (path.resolve(artifactPath) !== path.resolve(outputArtifactPath)) {
    await fs.copyFile(artifactPath, outputArtifactPath)
  }

  const manifest = {
    version,
    releaseName: options.releaseName ?? `Cradle ${version}`,
    releaseNotes: options.releaseNotes,
    releaseDate: options.releaseDate,
    minSupportedVersion: null,
    files: [
      {
        url: joinUrl(options.baseUrl, 'macos', artifactName),
        size: artifact.size,
        sha256: artifact.sha256,
        platform: 'darwin',
        arch,
      },
    ],
  }

  await fs.writeFile(options.out, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${path.relative(desktopRoot, options.out)}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
