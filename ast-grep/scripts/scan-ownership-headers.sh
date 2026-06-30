#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

cd "$ROOT_DIR"

node - "$@" <<'NODE'
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const searchArgs = process.argv.slice(2)
const rgArgs = [
  '--files',
  '--glob', '!apps/web/src/api-gen/**',
  '--glob', '!apps/server/src/modules/chat-runtime-providers/codex/app-server-protocol/**',
  '--glob', '!**/node_modules/**',
  '--glob', '!**/dist/**',
  '--glob', '!apps/desktop/release/**',
  '--glob', '!apps/desktop/release*/**',
  '--glob', '!**/.git/**',
  '--glob', '!pnpm-lock.yaml',
  '--glob', '!*.tsbuildinfo',
  ...searchArgs,
]

const result = spawnSync('rg', rgArgs, { encoding: 'utf8' })
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (result.status !== 0 && result.stdout.trim() === '') {
  process.exit(result.status ?? 1)
}

const lineHeader = /^\s*(?:(?:\/\/)|#|<!--|\/\*|\*)\s*(Output|Input|Position):/
const blockHeader = /^\s*\*\s*(Output|Input|Position):/
const bareHeader = /^\s*(Output|Input|Position):/
const labels = new Set(['Output', 'Input', 'Position'])
const hasOwnershipTriplet = found => (
  found.length === 3
  && found.every(label => labels.has(label))
  && new Set(found).size === 3
)

for (const file of result.stdout.trim().split('\n').filter(Boolean)) {
  let bytes
  try {
    bytes = readFileSync(file)
  }
  catch {
    continue
  }
  if (bytes.subarray(0, Math.min(bytes.length, 4096)).includes(0)) {
    continue
  }
  const text = bytes.toString('utf8')
  if (text.includes('\uFFFD')) {
    continue
  }
  const lines = text.split(/\r?\n/)
  const start = lines[0]?.startsWith('#!') ? 1 : 0

  const lineLabels = [0, 1, 2].map(offset => lines[start + offset]?.match(lineHeader)?.[1])
  if (hasOwnershipTriplet(lineLabels)) {
    for (let offset = 0; offset < 3; offset += 1) {
      console.log(`${file}:${start + offset + 1}:${lines[start + offset]}`)
    }
    continue
  }

  if (lines[start] === '/**') {
    const blockLabels = [0, 1, 2].map(offset => lines[start + 1 + offset]?.match(blockHeader)?.[1])
    if (hasOwnershipTriplet(blockLabels) && /^\s*\*\/\s*$/.test(lines[start + 4] ?? '')) {
      for (let offset = 1; offset <= 3; offset += 1) {
        console.log(`${file}:${start + offset + 1}:${lines[start + offset]}`)
      }
    }
  }

  if (lines[start] === '/*') {
    const blockLabels = [0, 1, 2].map(offset => lines[start + 1 + offset]?.match(blockHeader)?.[1])
    if (hasOwnershipTriplet(blockLabels) && /^\s*\*\/\s*$/.test(lines[start + 4] ?? '')) {
      for (let offset = 1; offset <= 3; offset += 1) {
        console.log(`${file}:${start + offset + 1}:${lines[start + offset]}`)
      }
    }
  }

  if (/^\s*<!--\s*$/.test(lines[start] ?? '')) {
    const htmlLabels = [0, 1, 2].map(offset => lines[start + 1 + offset]?.match(bareHeader)?.[1])
    if (hasOwnershipTriplet(htmlLabels) && /^\s*-->\s*$/.test(lines[start + 4] ?? '')) {
      for (let offset = 1; offset <= 3; offset += 1) {
        console.log(`${file}:${start + offset + 1}:${lines[start + offset]}`)
      }
    }
  }
}
NODE
