import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const relaydDir = fileURLToPath(new URL('..', import.meta.url))
const output = execFileSync(
  'go',
  ['test', '-count=1', '-run', '^$', '-bench', 'BenchmarkRelayForwardPath', '-benchmem', './internal/relay'],
  { cwd: relaydDir, encoding: 'utf8' },
)

process.stdout.write(output)

const expectedGenerations = [
  'v1-json-parse-reencode',
  'v2-before-parse-reencode',
  'v2-current-validated-passthrough',
]
const samples = new Map()
const linePattern = /^BenchmarkRelayForwardPath\/(?<size>[^/]+)\/(?<generation>.+)-\d+\s+\d+\s+(?<ns>[\d.]+) ns\/op\s+[\d.]+ MB\/s\s+(?<bytes>\d+) B\/op\s+(?<allocs>\d+) allocs\/op$/

for (const line of output.split('\n')) {
  const match = line.match(linePattern)
  if (!match?.groups) { continue }
  const { size, generation, ns, bytes, allocs } = match.groups
  if (!expectedGenerations.includes(generation)) { continue }
  const byGeneration = samples.get(size) ?? new Map()
  byGeneration.set(generation, { ns, bytes, allocs })
  samples.set(size, byGeneration)
}

const sizes = ['1KiB', '64KiB', '256KiB']
for (const size of sizes) {
  const byGeneration = samples.get(size)
  if (!byGeneration || expectedGenerations.some(generation => !byGeneration.has(generation))) {
    throw new Error(`Missing Relay benchmark result for ${size}; refusing to print a partial comparison.`)
  }
}

function renderSample(sample) {
  return `${sample.ns} ns/op · ${sample.bytes} B/op · ${sample.allocs} allocs/op`
}

console.info([
  '# Relay forwarding — actual three-generation comparison',
  '',
  'Same logical payload per row. Each generation processes its own actual wire frame; V1 JSON/Base64 is therefore intentionally larger than V2 binary.',
  '',
  '| Logical payload | V1 JSON parse + re-encode | V2 before pass-through | V2 current pass-through |',
  '| ---: | --- | --- | --- |',
  ...sizes.map((size) => {
    const byGeneration = samples.get(size)
    return `| ${size} | ${renderSample(byGeneration.get('v1-json-parse-reencode'))} | ${renderSample(byGeneration.get('v2-before-parse-reencode'))} | ${renderSample(byGeneration.get('v2-current-validated-passthrough'))} |`
  }),
  '',
  'V1 → V2 includes protocol/encoding changes. V2-before → V2-current keeps identical V2 wire bytes and isolates the Relay copy/re-encode elimination.',
].join('\n'))
