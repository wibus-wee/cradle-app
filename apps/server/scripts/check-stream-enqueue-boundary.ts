import { execSync } from 'node:child_process'
import path from 'node:path'

/**
 * Plan 077 ratchet: streaming responses must buffer through the shared
 * backpressure owner (`src/infra/sse-event-stream.ts`) or through an
 * explicitly reviewed entry on this allowlist. A raw
 * `controller.enqueue(...)` inside `src/modules/**` is only acceptable when
 * the site is pull-gated, finite, or already bounded by construction.
 *
 * Adding a file here requires a comment in that file explaining why its
 * enqueues cannot accumulate without bound.
 */
const ALLOWED_FILES = new Set([
  // Pull-based forwarder over another stream; enqueues mirror consumer pulls.
  // Also hosts the bounded chunk-stream drain + finite direct one-shot stream.
  'src/modules/chat-runtime/stream/sse.ts',
  // Bounded drain with snapshot-required fallback; stall watchdog reaps readers.
  'src/modules/chat-runtime/es/event-tail.ts',
  // Pull-driven consumption of the provider iterable; no producer buffering.
  'src/modules/chat-runtime/side-chat/live-stream.ts',
  // Pull-based pump over the app-server notification reader.
  'src/modules/chat-runtime/codex/host.ts',
  // App-server SSE bridge: bounded backlog drain (event+byte caps, `close`
  // overflow policy, stall watchdog) feeding protocol frames.
  'src/modules/chat-runtime-providers/codex/app-server/bridge.ts',
  // Finite `?once=1` snapshot stream; closes after one synchronous flush.
  'src/modules/chronicle/index.ts',
  // Finite export archive stream; closes when the source iterator drains.
  'src/modules/session/index.ts',
])

function listMatches(): string[] {
  const root = path.resolve(import.meta.dirname, '..')
  const pattern = 'controller\\.enqueue\\(|streamController\\.enqueue\\(|nextController\\.enqueue\\('
  const command = [
    'rg',
    '-l',
    JSON.stringify(pattern),
    'src/modules',
    '--type ts',
    '-g \'!*.test.ts\'',
  ].join(' ')
  const output = execSync(command, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return output.split('\n').map(line => line.trim()).filter(Boolean)
}

function main(): void {
  const offenders = listMatches().filter(file => !ALLOWED_FILES.has(file))
  if (offenders.length === 0) {
    console.log('Stream enqueue boundary check passed')
    return
  }
  console.error('Raw controller.enqueue outside the Plan 077 allowlist:')
  for (const file of offenders) {
    console.error(`  ${file}`)
  }
  console.error(
    'Buffer streaming responses through src/infra/sse-event-stream.ts, or '
    + 'add the file to ALLOWED_FILES with justification if its enqueues are '
    + 'pull-gated or finite.',
  )
  process.exit(1)
}

main()
