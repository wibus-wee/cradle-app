#!/usr/bin/env node
/**
 * Server boot baseline: measures process-spawn → per-phase bootstrap timing →
 * listening, plus RSS at boot+2s and idle+10s. N cold runs, median reported.
 *
 * Usage: node scripts/desktop-startup-baseline/measure-server-boot.mjs [runs=3]
 *
 * Requires apps/server/dist built (pnpm --filter @cradle/server build).
 * Uses a fresh empty data dir per run. Numbers are boot-upper-bound: the
 * harness measures with unbuilt plugins (activation errors are fast noise);
 * packaged reality may differ slightly.
 */
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
const RUNS = Number(process.argv[2] ?? 3)

function probePort(port, timeoutMs = 300) {
  return new Promise((res) => {
    const sock = net.connect(port, '127.0.0.1')
    const done = (ok) => { sock.destroy(); res(ok) }
    sock.setTimeout(timeoutMs)
    sock.on('connect', () => done(true))
    sock.on('timeout', () => done(false))
    sock.on('error', () => done(false))
  })
}

function rssKb(pid) {
  try {
    const out = String(execSyncSafe(`ps -o rss= -p ${pid}`)).trim()
    return Number(out) || null
  }
 catch { return null }
}
function execSyncSafe(cmd) {
 try { return execSync(cmd) }
 catch { return '' }
}

async function oneRun(idx) {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-baseline-'))
  const t0 = performance.now()
  const child = spawn('node', ['dist/main.js'], {
    cwd: join(ROOT, 'apps/server'),
    env: {
      ...process.env,
      CRADLE_DATA_DIR: dataDir,
      CRADLE_MIGRATIONS_DIR: join(ROOT, 'packages/db/drizzle'),
      CRADLE_OTEL_ENABLED: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const phases = []
  let listenPort = null
  let listenAtMs = null
  let output = ''
  child.stdout.on('data', (d) => {
    output += d
    const m = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)
    if (m && !listenPort) {
      listenPort = Number(m[1])
      listenAtMs = performance.now() - t0
    }
  })
  child.stderr.on('data', (d) => { output += d })
  child.on('message', (msg) => {
    if (msg?.type === 'cradle-server-bootstrap') {
      phases.push({ phase: msg.phase, kind: msg.kind, atMs: performance.now() - t0 })
    }
  })
  // wait for listening or death
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (listenPort || child.exitCode !== null) { break }
    await new Promise(r => setTimeout(r, 100))
  }
  const result = { idx, phases, listenAtMs, rss: {}, error: null }
  if (!listenPort) {
    result.error = `never listened; exit=${child.exitCode}`
    child.kill('SIGKILL')
    rmSync(dataDir, { recursive: true, force: true })
    return result
  }
  // confirm port answers
  result.portAnswers = await probePort(listenPort)
  await new Promise(r => setTimeout(r, 2000))
  result.rss.boot2sMb = (rssKb(child.pid) ?? 0) / 1024
  await new Promise(r => setTimeout(r, 8000))
  result.rss.idle10sMb = (rssKb(child.pid) ?? 0) / 1024
  // child processes
  const kids = execSyncSafe(`pgrep -P ${child.pid}`).trim().split('\n').filter(Boolean)
  result.children = kids.map(k => ({ pid: k, rssMb: (rssKb(k) ?? 0) / 1024, cmd: String(execSyncSafe(`ps -o comm= -p ${k}`)).trim() }))
  result.totalTreeMb = result.rss.idle10sMb + result.children.reduce((a, c) => a + c.rssMb, 0)
  child.kill('SIGTERM')
  await new Promise(r => setTimeout(r, 500))
  if (child.exitCode === null) { child.kill('SIGKILL') }
  rmSync(dataDir, { recursive: true, force: true })
  return result
}

const results = []
for (let i = 0; i < RUNS; i++) { results.push(await oneRun(i)) }

const med = arr => arr.filter(x => x != null).sort((a, b) => a - b)[Math.floor(arr.length / 2)]
const okRuns = results.filter(r => !r.error)
const summary = {
  runs: results.length,
  failures: results.filter(r => r.error).map(r => r.error),
  listenAtMsMedian: med(okRuns.map(r => r.listenAtMs)),
  rssBoot2sMedianMb: med(okRuns.map(r => r.rss.boot2sMb)),
  rssIdle10sMedianMb: med(okRuns.map(r => r.rss.idle10sMb)),
  totalTreeMedianMb: med(okRuns.map(r => r.totalTreeMb)),
  perPhaseMedianMs: {},
}
// phase timing: completed - started per phase
const phaseNames = [...new Set(okRuns.flatMap(r => r.phases.map(p => p.phase)))]
for (const ph of phaseNames) {
  const durs = okRuns.map((r) => {
    const s = r.phases.find(p => p.phase === ph && p.kind === 'started')
    const c = r.phases.find(p => p.phase === ph && (p.kind === 'completed' || p.kind === 'ready'))
    return s && c ? c.atMs - s.atMs : null
  }).filter(x => x != null)
  if (durs.length) { summary.perPhaseMedianMs[ph] = med(durs) }
}
console.log(JSON.stringify({ summary, results: okRuns.map(({ idx, listenAtMs, rss, children, totalTreeMb, phases }) => ({ idx, listenAtMs, rss, children, totalTreeMb, phaseCount: phases.length })) }, null, 2))
