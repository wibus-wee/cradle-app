import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const artifactsDir = resolve(process.cwd(), 'e2e', 'artifacts')
const canonicalFilename = 'failure-index.json'
const workerFilenamePattern = /^failure-index\.w\d+\.json$/

function indexFilenames() {
  if (!existsSync(artifactsDir)) {
    return []
  }
  return readdirSync(artifactsDir)
    .filter(name => name === canonicalFilename || workerFilenamePattern.test(name))
    .sort()
}

function prepare() {
  for (const filename of indexFilenames()) {
    unlinkSync(join(artifactsDir, filename))
  }
}

function readEntries(filename) {
  const value = JSON.parse(readFileSync(join(artifactsDir, filename), 'utf8'))
  if (!Array.isArray(value)) {
    throw new TypeError(`${filename} must contain a JSON array`)
  }
  return value
}

function merge() {
  const filenames = indexFilenames()
  const workerFilenames = filenames.filter(filename => workerFilenamePattern.test(filename))
  const sourceFilenames = workerFilenames.length > 0
    ? workerFilenames
    : filenames.filter(filename => filename === canonicalFilename)
  const entries = sourceFilenames
    .flatMap(readEntries)
    .sort((left, right) =>
      String(left.relativeDir).localeCompare(String(right.relativeDir)))

  writeFileSync(
    join(artifactsDir, canonicalFilename),
    `${JSON.stringify(entries, null, 2)}\n`,
    'utf8',
  )
  for (const filename of workerFilenames) {
    unlinkSync(join(artifactsDir, filename))
  }
}

const command = process.argv[2]
if (command === 'prepare') {
  prepare()
}
else if (command === 'merge') {
  merge()
}
else {
  throw new Error('Usage: node e2e/scripts/failure-index.mjs <prepare|merge>')
}
