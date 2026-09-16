#!/usr/bin/env node

/**
 * Regenerate `src/modules/image-ocr/ocr-model-manifest.json` from the
 * installed dependency tree.
 *
 * The PP-OCRv6 Small model ships as the `@arcships/light-ocr-model-*` npm
 * package required by `@arcships/light-ocr`. The packaged server prunes that
 * model payload, so the managed-resource download needs the package tarball
 * URL, npm `dist.integrity` sha512, and unpacked size pinned here.
 */

import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = resolve(SCRIPT_DIR, '..')
const MANIFEST_PATH = join(SERVER_ROOT, 'src/modules/image-ocr/ocr-model-manifest.json')

const MODEL_PACKAGE = '@arcships/light-ocr-model-ppocrv6-small'
const FACADE_PACKAGE = '@arcships/light-ocr'
const REGISTRY = 'https://registry.npmjs.org'

function requireFromServer() {
  return createRequire(join(SERVER_ROOT, 'package.json'))
}

function resolveInstalledModelPackage() {
  const serverRequire = requireFromServer()
  const facadeEntry = serverRequire.resolve(FACADE_PACKAGE)
  const facadeRequire = createRequire(facadeEntry)
  const bundleManifestPath = facadeRequire.resolve(`${MODEL_PACKAGE}/bundle/manifest.json`)
  const packageRoot = dirname(dirname(bundleManifestPath))
  const packageJson = serverRequire(join(packageRoot, 'package.json'))
  return {
    name: packageJson.name,
    version: packageJson.version,
    bundleId: packageJson.lightOcr?.bundleId ?? null,
  }
}

async function fetchPackument(packageName) {
  const url = `${REGISTRY}/${packageName.replace('/', '%2F')}`
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`npm packument request failed for ${packageName}: HTTP ${response.status}`)
  }
  return await response.json()
}

function sha512IntegrityToHex(integrity) {
  const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity ?? '')
  if (!match) {
    throw new Error(`Expected sha512 integrity, received: ${integrity}`)
  }
  return Buffer.from(match[1], 'base64').toString('hex')
}

const installed = resolveInstalledModelPackage()
if (!installed.bundleId) {
  throw new Error(`${MODEL_PACKAGE} package.json is missing lightOcr.bundleId`)
}

const packument = await fetchPackument(MODEL_PACKAGE)
const release = packument.versions?.[installed.version]
if (!release) {
  throw new Error(`npm registry has no ${MODEL_PACKAGE}@${installed.version}`)
}
const dist = release.dist ?? {}
if (!dist.tarball || !dist.integrity || !dist.unpackedSize) {
  throw new Error(`npm dist metadata is incomplete for ${MODEL_PACKAGE}@${installed.version}`)
}

const manifest = {
  schemaVersion: 1,
  packageName: MODEL_PACKAGE,
  version: installed.version,
  bundleId: installed.bundleId,
  registry: REGISTRY,
  tarball: dist.tarball,
  unpackedSizeBytes: dist.unpackedSize,
  sha512: sha512IntegrityToHex(dist.integrity),
}

await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`wrote ${MANIFEST_PATH}`)
console.log(`  ${MODEL_PACKAGE}@${installed.version} (${installed.bundleId})`)
console.log(`  ${dist.tarball}`)
