#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(scriptDir, '..')
const releaseDir = path.resolve(process.argv[2] ?? path.join(desktopRoot, 'release'))
const manifestPath = path.join(releaseDir, 'latest-linux.yml')
const packageJsonPath = path.join(desktopRoot, 'package.json')
const requiredExtensions = ['.AppImage', '.deb', '.rpm']

async function hashFile(file) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk)
  }
  return hash.digest('base64')
}

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
const artifacts = await readdir(releaseDir, { withFileTypes: true })
const releaseFiles = []

for (const extension of requiredExtensions) {
  const names = artifacts
    .filter(entry => entry.isFile() && entry.name.endsWith(extension))
    .map(entry => entry.name)

  if (names.length !== 1) {
    throw new Error(`Expected exactly one ${extension} artifact, found ${names.length}`)
  }

  const [name] = names
  const artifactPath = path.join(releaseDir, name)
  const [sha512, artifactStats] = await Promise.all([
    hashFile(artifactPath),
    stat(artifactPath),
  ])
  releaseFiles.push({ name, sha512, size: artifactStats.size })
}

const [primaryArtifact] = releaseFiles
const lines = [
  `version: ${packageJson.version}`,
  'files:',
  ...releaseFiles.flatMap(({ name, sha512, size }) => [
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
  ]),
  `path: ${primaryArtifact.name}`,
  `sha512: ${primaryArtifact.sha512}`,
  `releaseDate: ${new Date().toISOString()}`,
]

await writeFile(manifestPath, `${lines.join('\n')}\n`, 'utf8')
console.log(`Generated Linux updater manifest for ${releaseFiles.length} release targets in ${releaseDir}`)
