import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const resultPath = resolve(
  'apps/desktop/.server-fetch-smoke',
  `resource-development-${process.platform}-${process.arch}.json`,
)
const summaryPath = process.env.GITHUB_STEP_SUMMARY

try {
  const result = JSON.parse(await readFile(resultPath, 'utf8'))
  const mib = value => value === null || value === undefined
    ? 'n/a'
    : (value / 1024 / 1024).toFixed(1)
  const markdown = [
    '# Desktop resource soak',
    '',
    `- Result: **${result.passed ? 'PASS' : 'FAIL'}**`,
    `- Duration: ${(result.config.durationMs / 60_000).toFixed(1)} minutes`,
    `- Context envelope: ${result.config.contextTokens.toLocaleString()} approximate tokens / ${mib(result.counters.chatRequestBytes)} MiB JSON`,
    `- Finite requests accepted: ${result.counters.finiteRequestsAccepted.toLocaleString()}`,
    `- Main baseline private memory: ${mib(result.summary.baselineMainPrivateBytes)} MiB`,
    `- Main peak private memory: ${mib(result.summary.peakMainPrivateBytes)} MiB`,
    `- Main peak delta: ${mib(result.summary.mainPeakDeltaBytes)} MiB`,
    `- Main settled delta: ${mib(result.summary.mainSettledDeltaBytes)} MiB`,
    `- Main peak V8 heap: ${mib(result.summary.peakMainHeapBytes)} MiB`,
    `- Main peak CPU: ${result.summary.peakMainCpuPercent.toFixed(1)}%`,
    `- Renderer peak private memory: ${mib(result.summary.peakRendererPrivateBytes)} MiB`,
    `- Generic streamed bytes: ${mib(result.counters.streamBytesWritten)} MiB`,
    `- Chat chunks: ${result.counters.chatChunksWritten.toLocaleString()}`,
    '',
  ].join('\n')
  if (summaryPath) {
    await appendFile(summaryPath, markdown)
  }
  console.log(markdown)
}
catch (error) {
  const markdown = `# Desktop resource soak\n\nResult JSON unavailable: ${error.message}\n`
  if (summaryPath) {
    await appendFile(summaryPath, markdown)
  }
  console.error(markdown)
}
