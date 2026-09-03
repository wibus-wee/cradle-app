import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

import { app, BrowserWindow, ipcMain } from 'electron'

import { DesktopServerFetchBroker } from '../../src/main/server-fetch-broker'

const ITERATIONS = 10
const REQUESTS_PER_DOCUMENT = 4
const WAIT_TIMEOUT_MS = 3_000

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(message)
}

async function waitForLoad(window: BrowserWindow, action: () => void | Promise<void>): Promise<void> {
  const loaded = new Promise<void>((resolve, reject) => {
    const handleFinished = () => {
      window.webContents.removeListener('did-fail-load', handleFailed)
      resolve()
    }
    const handleFailed = (_event: Electron.Event, code: number, description: string) => {
      window.webContents.removeListener('did-finish-load', handleFinished)
      reject(new Error(`renderer load failed (${code}): ${description}`))
    }
    window.webContents.once('did-finish-load', handleFinished)
    window.webContents.once('did-fail-load', handleFailed)
  })
  await action()
  await loaded
}

async function run(): Promise<void> {
  await app.whenReady()
  let responseCloseCount = 0
  const server = createServer((request, response) => {
    response.once('close', () => {
      responseCloseCount += 1
    })
    if (request.url?.startsWith('/large')) {
      response.writeHead(200, {
        'content-length': String(2 * 1024 * 1024),
        'content-type': 'application/octet-stream',
      })
      response.flushHeaders()
      response.write(Buffer.alloc(1024 * 1024, 5))
    }
    else {
      response.writeHead(200, {
        'cache-control': 'no-cache',
        'content-type': 'text/event-stream',
      })
      response.flushHeaders()
      response.write(': connected\n\n')
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  let window: BrowserWindow | null = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`preload failed (${preloadPath}):`, error)
  })
  const broker = new DesktopServerFetchBroker({
    isAllowedSender: sender => window !== null && sender.id === window.webContents.id,
  })
  broker.register(ipcMain)
  broker.setServerUrl(`http://127.0.0.1:${address.port}`, 1)

  const activeAfterOpen: number[] = []
  const activeAfterNavigation: number[] = []
  try {
    await waitForLoad(window, () => window!.loadFile(join(__dirname, 'renderer.html')))
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      if (iteration > 0) {
        await waitForLoad(window, () => window!.reload())
        await waitFor(
          () => broker.diagnostics().activeRequests === 0
            && responseCloseCount >= iteration * REQUESTS_PER_DOCUMENT,
          `iteration ${iteration}: old document did not release its request`,
        )
        activeAfterNavigation.push(broker.diagnostics().activeRequests)
      }
      const heads = await window.webContents.executeJavaScript(
        `globalThis.serverFetchSmoke.openAll(${JSON.stringify(iteration)})`,
        true,
      ) as Array<{ status?: number, cancelled?: true }>
      if (heads.length !== REQUESTS_PER_DOCUMENT || heads.some(head => head.status !== 200 || head.cancelled)) {
        throw new Error(`iteration ${iteration}: requests did not open`)
      }
      activeAfterOpen.push(broker.diagnostics().activeRequests)
    }

    await waitForLoad(window, () => window!.loadURL('data:text/html,<title>done</title>'))
    await waitFor(
      () => broker.diagnostics().activeRequests === 0
        && responseCloseCount === ITERATIONS * REQUESTS_PER_DOCUMENT,
      'final navigation did not release every request',
    )
    activeAfterNavigation.push(broker.diagnostics().activeRequests)
    const result = {
      iterations: ITERATIONS,
      requestsPerDocument: REQUESTS_PER_DOCUMENT,
      activeAfterOpen,
      activeAfterNavigation,
      responseCloseCount,
      finalDiagnostics: broker.diagnostics(),
    }
    console.log(`SERVER_FETCH_LIFECYCLE_SMOKE ${JSON.stringify(result)}`)
  }
  finally {
    window.destroy()
    window = null
    await broker.close()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

void run().then(
  () => app.exit(0),
  (error) => {
    console.error(error)
    app.exit(1)
  },
)
