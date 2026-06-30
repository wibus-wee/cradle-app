interface RuntimeSnapshot {
  server?: {
    memory?: {
      rssMB?: number
      heapUsedMB?: number
      heapTotalMB?: number
      externalMB?: number
      arrayBuffersMB?: number
    }
  }
}

interface Sample {
  iteration: number
  sampledAt: number
  rssMB: number | null
  heapUsedMB: number | null
  heapTotalMB: number | null
  externalMB: number | null
  arrayBuffersMB: number | null
}

interface CliOptions {
  serverUrl: string
  iterations: number
  delayMs: number
  workflowPath: string | null
}

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name)
  if (index === -1 || index + 1 >= process.argv.length) {
    return null
  }
  return process.argv[index + 1] ?? null
}

function readNumberArg(name: string, defaultValue: number): number {
  const raw = readArg(name)
  if (!raw) {
    return defaultValue
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

function readOptions(): CliOptions {
  return {
    serverUrl: readArg('--server') ?? process.env.CRADLE_SERVER_URL ?? 'http://127.0.0.1:21423',
    iterations: readNumberArg('--iterations', 50),
    delayMs: readNumberArg('--delay-ms', 250),
    workflowPath: readArg('--workflow-path'),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`GET ${url.pathname} failed with HTTP ${response.status}`)
  }
  return response.json()
}

async function callWorkflow(serverUrl: string, path: string | null): Promise<void> {
  if (!path) {
    return
  }
  await fetchJson(new URL(path, serverUrl))
}

async function readSnapshot(serverUrl: string, iteration: number): Promise<Sample> {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
  }
  const snapshot = await fetchJson(new URL('/observability/runtime-snapshot', serverUrl)) as RuntimeSnapshot
  const memory = snapshot.server?.memory
  return {
    iteration,
    sampledAt: Date.now(),
    rssMB: memory?.rssMB ?? null,
    heapUsedMB: memory?.heapUsedMB ?? null,
    heapTotalMB: memory?.heapTotalMB ?? null,
    externalMB: memory?.externalMB ?? null,
    arrayBuffersMB: memory?.arrayBuffersMB ?? null,
  }
}

function delta(first: number | null, last: number | null): number | null {
  return first === null || last === null ? null : Math.round((last - first) * 100) / 100
}

async function main(): Promise<void> {
  const options = readOptions()
  const samples: Sample[] = []

  for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
    await callWorkflow(options.serverUrl, options.workflowPath)
    samples.push(await readSnapshot(options.serverUrl, iteration))
    if (iteration < options.iterations) {
      await sleep(options.delayMs)
    }
  }

  const first = samples[0]
  const last = samples.at(-1)
  const summary = {
    serverUrl: options.serverUrl,
    iterations: options.iterations,
    delayMs: options.delayMs,
    workflowPath: options.workflowPath,
    gcAvailable: typeof globalThis.gc === 'function',
    delta: first && last
      ? {
          rssMB: delta(first.rssMB, last.rssMB),
          heapUsedMB: delta(first.heapUsedMB, last.heapUsedMB),
          heapTotalMB: delta(first.heapTotalMB, last.heapTotalMB),
          externalMB: delta(first.externalMB, last.externalMB),
          arrayBuffersMB: delta(first.arrayBuffersMB, last.arrayBuffersMB),
        }
      : null,
    samples,
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
})
