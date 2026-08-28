import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, freemem, platform, release, totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { chromium } from '@playwright/test'
import react from '@vitejs/plugin-react'
import { build, createServer } from 'vite'

const benchmarkDirectory = dirname(fileURLToPath(import.meta.url))
const packageDirectory = resolve(benchmarkDirectory, '..')
const rendererNames = ['cradle', 'markstream']
const scenarios = [
  { name: 'completed', targetChars: 12_000 },
  { name: 'typical-stream', targetChars: 2_500, chunkChars: 16, chunkDelayMs: 67 },
  { name: 'paced-production', targetChars: 8_000, chunkChars: 64, chunkDelayMs: 16 },
  { name: 'burst-full-render', targetChars: 48_000, chunkChars: 512 },
  { name: 'long-document', targetChars: 160_000 },
]

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const sampleCount = Number(readArgument('--samples', '5'))
const warmupCount = Number(readArgument('--warmups', '1'))
const outputPath = resolve(
  packageDirectory,
  readArgument('--output', 'benchmark/results/latest.json'),
)

if (
  !Number.isInteger(sampleCount)
  || sampleCount < 1
  || !Number.isInteger(warmupCount)
  || warmupCount < 0
) {
  throw new Error('--samples must be >= 1 and --warmups must be >= 0')
}

function metricMap(result) {
  return Object.fromEntries(result.metrics.map(metric => [metric.name, metric.value]))
}

function delta(after, before, name) {
  return (after[name] ?? 0) - (before[name] ?? 0)
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

function summarize(samples) {
  const successfulSamples = samples.filter(sample => sample.status === 'ok')
  if (successfulSamples.length === 0) {
    return { successfulSamples: 0, failedSamples: samples.length }
  }

  const numericKeys = Object.keys(successfulSamples[0]).filter(
    key => typeof successfulSamples[0][key] === 'number',
  )
  return {
    successfulSamples: successfulSamples.length,
    failedSamples: samples.length - successfulSamples.length,
    metrics: Object.fromEntries(
      numericKeys.map((key) => {
        const values = successfulSamples.map(sample => sample[key])
        return [
          key,
          {
            median: percentile(values, 0.5),
            p95: percentile(values, 0.95),
            min: Math.min(...values),
            max: Math.max(...values),
          },
        ]
      }),
    ),
  }
}

async function measureBundle(rendererName) {
  const result = await build({
    root: benchmarkDirectory,
    configFile: false,
    logLevel: 'silent',
    plugins: [react()],
    resolve: { dedupe: ['react', 'react-dom'] },
    build: {
      minify: 'esbuild',
      write: false,
      rollupOptions: {
        input: resolve(benchmarkDirectory, `src/entries/${rendererName}.tsx`),
        external: id =>
          id === 'react'
          || id === 'react-dom'
          || id.startsWith('react-dom/')
          || id.startsWith('react/'),
      },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output)
  const entries = outputs.filter(item => item.type === 'chunk' && item.isEntry)
  const payload = outputs.map((item) => {
    const body = item.type === 'asset' ? item.source : item.code
    return {
      fileName: item.fileName,
      kind: item.type === 'chunk' ? (item.isEntry ? 'entry' : 'async') : 'asset',
      rawBytes: Buffer.byteLength(body),
      gzipBytes: gzipSync(body).byteLength,
    }
  })
  return {
    entryFiles: entries.map(item => item.fileName),
    rawBytes: payload.reduce((total, item) => total + item.rawBytes, 0),
    gzipBytes: payload.reduce((total, item) => total + item.gzipBytes, 0),
    entryRawBytes: payload
      .filter(item => item.kind === 'entry')
      .reduce((total, item) => total + item.rawBytes, 0),
    entryGzipBytes: payload
      .filter(item => item.kind === 'entry')
      .reduce((total, item) => total + item.gzipBytes, 0),
    files: payload,
  }
}

async function measureSample(browser, baseUrl, rendererName, scenario) {
  const page = await browser.newPage()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text())
    }
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${baseUrl}/?renderer=${rendererName}`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__benchmark?.ready === true)

  const client = await page.context().newCDPSession(page)
  await client.send('Performance.enable')
  await client.send('HeapProfiler.collectGarbage')
  const before = metricMap(await client.send('Performance.getMetrics'))
  let pageResult
  let failure
  try {
    pageResult = await page.evaluate(definition => window.__benchmark.run(definition), scenario)
  }
 catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  const after = metricMap(await client.send('Performance.getMetrics'))
  await client.send('HeapProfiler.collectGarbage')
  const afterGarbageCollection = metricMap(await client.send('Performance.getMetrics'))
  const domCounters = await client.send('Memory.getDOMCounters')
  await page.close()

  if (failure || errors.length > 0 || !pageResult) {
    return {
      status: 'failed',
      error: [failure, ...errors].filter(Boolean).join('\n'),
      taskMs: delta(after, before, 'TaskDuration') * 1000,
    }
  }

  const taskMs = delta(after, before, 'TaskDuration') * 1000
  return {
    status: 'ok',
    ...pageResult,
    taskMs,
    cpuPercent: pageResult.wallMs > 0 ? (taskMs / pageResult.wallMs) * 100 : 0,
    scriptMs: delta(after, before, 'ScriptDuration') * 1000,
    layoutMs: delta(after, before, 'LayoutDuration') * 1000,
    styleMs: delta(after, before, 'RecalcStyleDuration') * 1000,
    heapDeltaBytes: delta(afterGarbageCollection, before, 'JSHeapUsedSize'),
    documents: domCounters.documents,
    browserNodes: domCounters.nodes,
    jsEventListeners: domCounters.jsEventListeners,
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile(resolve(packageDirectory, 'package.json'), 'utf8'))
  const server = await createServer({
    root: benchmarkDirectory,
    configFile: false,
    logLevel: 'error',
    plugins: [react()],
    resolve: { dedupe: ['react', 'react-dom'] },
    server: { host: '127.0.0.1', port: 0 },
  })

  let browser
  try {
    await server.listen()
    const address = server.httpServer.address()
    if (!address || typeof address === 'string') {
      throw new Error('Vite did not expose a TCP address')
    }
    const baseUrl = `http://127.0.0.1:${address.port}`
    browser = await chromium.launch({ channel: 'chrome', headless: true })

    const results = {}
    for (const scenario of scenarios) {
      results[scenario.name] = {}
      for (const rendererName of rendererNames) {
        for (let warmup = 0; warmup < warmupCount; warmup += 1) {
          await measureSample(browser, baseUrl, rendererName, scenario)
        }
        const samples = []
        for (let sample = 0; sample < sampleCount; sample += 1) {
          process.stdout.write(
            `Measuring ${scenario.name} / ${rendererName} (${sample + 1}/${sampleCount})\n`,
          )
          samples.push(await measureSample(browser, baseUrl, rendererName, scenario))
        }
        results[scenario.name][rendererName] = { samples, summary: summarize(samples) }
      }
    }

    const bundles = Object.fromEntries(
      await Promise.all(
        rendererNames.map(async rendererName => [rendererName, await measureBundle(rendererName)]),
      ),
    )
    const browserVersion = await browser.version()
    const output = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      command: `pnpm --filter @cradle/streamdown benchmark -- --samples ${sampleCount} --warmups ${warmupCount}`,
      environment: {
        platform: platform(),
        release: release(),
        cpu: cpus()[0]?.model ?? 'unknown',
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
        freeMemoryBytesAtStart: freemem(),
        node: process.version,
        chromium: browserVersion,
      },
      versions: {
        cradle: packageJson.version,
        markstream: packageJson.devDependencies['markstream-react'],
      },
      configuration: { sampleCount, warmupCount, scenarios },
      bundles,
      results,
    }
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`)
    process.stdout.write(`Wrote ${outputPath}\n`)
  }
 finally {
    await browser?.close()
    await server.close()
  }
}

void main()
