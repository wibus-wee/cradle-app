#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDir, '..')
const releaseDir = path.resolve(process.argv[2] ?? path.join(desktopRoot, 'release'))
const manifestPath = path.join(releaseDir, 'latest-linux.yml')

if (!existsSync(manifestPath)) {
  throw new Error(`Missing Linux updater manifest: ${manifestPath}`)
}

const artifacts = readdirSync(releaseDir)
const manifest = readFileSync(manifestPath, 'utf8')
const requiredExtensions = ['.AppImage', '.deb', '.rpm']

async function hashFile(file) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk)
  }
  return hash.digest('base64')
}

for (const extension of requiredExtensions) {
  const names = artifacts.filter(name => name.endsWith(extension))
  if (names.length !== 1) {
    throw new Error(`Expected exactly one ${extension} artifact, found ${names.length}`)
  }

  const [name] = names
  const artifactPath = path.join(releaseDir, name)
  const sha512 = await hashFile(artifactPath)

  if (!manifest.includes(name)) {
    throw new Error(`latest-linux.yml does not reference ${name}`)
  }
  if (!manifest.includes(`sha512: ${sha512}`)) {
    throw new Error(`latest-linux.yml does not contain the SHA-512 digest for ${name}`)
  }
}

console.log(`Verified Linux updater manifest and ${requiredExtensions.length} release targets in ${releaseDir}`)
