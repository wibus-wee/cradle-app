import { mkdir, writeFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'

import { app, BrowserWindow, ipcMain } from 'electron'

import { DesktopServerFetchBroker } from '../server-fetch-broker'

const WINDOW_COUNT = 21
const resultPath = process.env.CRADLE_SERVER_FETCH_SMOKE_RESULT
const windows = new Map<number, BrowserWindow>()
const windowIndexes = new Map<number, number>()
const finiteResponses: Array<{ response: ServerResponse, window: number }> = []
const completed = new Map<number, { finite: string, stream?: string }>()
let acceptedRequests = 0
let settled = false

const server = createServer((request, response) => {
  acceptedRequests += 1
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/finite') {
    const window = Number(url.searchParams.get('window'))
    finiteResponses.push({ response, window })
    if (finiteResponses.length === WINDOW_COUNT) {
      for (const pending of finiteResponses) {
        pending.response.writeHead(200, { 'content-type': 'application/json' })
        pending.response.end(JSON.stringify({ window: pending.window }))
      }
    }
    return
  }
  if (url.pathname === '/stream') {
    response.writeHead(200, {
      'cache-control': 'no-cache',
      'content-type': 'text/event-stream',
    })
    response.write('data: alpha\n\n')
    setTimeout(() => response.end('data: beta\n\n'), 20).unref()
    return
  }
  response.writeHead(404).end('not found')
})

const broker = new DesktopServerFetchBroker({
  isAllowedSender: sender => windows.has(sender.id),
})

async function finish(passed: boolean, error?: unknown): Promise<void> {
  if (settled) {
    return
  }
  settled = true
  const result = {
    schemaVersion: 1,
    passed,
    windowCount: WINDOW_COUNT,
    finiteRequests: finiteResponses.length,
    acceptedRequests,
    diagnostics: broker.diagnostics(),
    error: error instanceof Error ? error.message : error ? String(error) : null,
  }
  if (resultPath) {
    await mkdir(dirname(resultPath), { recursive: true })
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  }
  console.log(`CRADLE_SERVER_FETCH_SMOKE=${JSON.stringify(result)}`)
  for (const window of windows.values()) {
    if (!window.isDestroyed()) {
      window.destroy()
    }
  }
  await broker.close().catch(() => {})
  await new Promise<void>(resolve => server.close(() => resolve()))
  app.exit(passed ? 0 : 1)
}

async function run(): Promise<void> {
  broker.register(ipcMain)
  ipcMain.on('server-fetch-smoke:complete', (event, input: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const index = window ? windowIndexes.get(event.sender.id) : undefined
    if (index === undefined || !isCompletion(input)) {
      void finish(false, new Error('Invalid smoke completion payload or sender.'))
      return
    }
    completed.set(index, input)
    if (completed.size !== WINDOW_COUNT) {
      return
    }
    const allFinite = [...completed.values()].every(result => result.finite === 'ok')
    const stream = completed.get(0)?.stream
    void finish(
      allFinite
      && stream === 'data: alpha\n\ndata: beta\n\n'
      && finiteResponses.length === WINDOW_COUNT
      && acceptedRequests === WINDOW_COUNT + 1,
      allFinite ? undefined : new Error('At least one renderer returned an invalid finite result.'),
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Smoke Server did not expose a TCP address.')
  }
  broker.setServerUrl(`http://127.0.0.1:${address.port}`, 1)

  const preload = join(__dirname, '../preload/index.js')
  const renderer = join(__dirname, '../renderer/index.html')
  for (let index = 0; index < WINDOW_COUNT; index += 1) {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload,
        sandbox: true,
      },
    })
    windows.set(window.webContents.id, window)
    windowIndexes.set(window.webContents.id, index)
    await window.loadFile(renderer, { query: { index: String(index) } })
  }
}

function isCompletion(input: unknown): input is { finite: string, stream?: string } {
  if (!input || typeof input !== 'object') {
    return false
  }
  const record = input as Record<string, unknown>
  return typeof record.finite === 'string'
    && (record.stream === undefined || typeof record.stream === 'string')
}

if (process.env.CRADLE_SERVER_FETCH_SMOKE_PROFILE === 'resource') {
  void import('./resource-main').catch(error => finish(false, error))
}
else {
  const timeout = setTimeout(() => {
    void finish(false, new Error('Server fetch smoke timed out.'))
  }, 45_000)
  timeout.unref()

  app.whenReady().then(run).catch(error => finish(false, error))
}
