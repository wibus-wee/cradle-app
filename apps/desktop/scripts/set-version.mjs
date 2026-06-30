#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(scriptDir, '..')
const packageJsonPath = resolve(desktopRoot, 'package.json')
const version = process.argv[2]?.trim()

if (!version) {
  throw new Error('Usage: pnpm --filter @cradle/desktop set-version -- <version>')
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Desktop version must be SemVer-compatible: ${version}`)
}

const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
packageJson.version = version

await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
console.log(`Set @cradle/desktop version to ${version}`)
