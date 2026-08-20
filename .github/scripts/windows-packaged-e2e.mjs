#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')
const exePath = process.env.CRADLE_E2E_EXE_PATH
  ? resolve(process.env.CRADLE_E2E_EXE_PATH)
  : resolve(repoRoot, 'apps/desktop/release/win-unpacked/Cradle.exe')
const artifactName = process.env.CRADLE_E2E_ARTIFACT_NAME?.trim() || 'win-unpacked'
const artifactsDir = resolve(repoRoot, 'e2e/artifacts/windows-packaged-e2e', artifactName)
const appDataRoot = resolve(repoRoot, 'tmp/windows-packaged-e2e-appdata', artifactName)

if (process.platform !== 'win32') {
  throw new Error('windows-packaged-e2e must run on Windows because it launches Cradle.exe.')
}

if (!existsSync(exePath)) {
  throw new Error(`Packaged Cradle.exe not found at ${exePath}`)
}

rmSync(artifactsDir, { recursive: true, force: true })
rmSync(appDataRoot, { recursive: true, force: true })
mkdirSync(artifactsDir, { recursive: true })
mkdirSync(resolve(appDataRoot, 'Roaming'), { recursive: true })
mkdirSync(resolve(appDataRoot, 'Local'), { recursive: true })
mkdirSync(resolve(appDataRoot, 'Temp'), { recursive: true })

const remoteDebuggingPort = await reserveAvailablePort()
const child = spawn(exePath, [
  `--remote-debugging-port=${remoteDebuggingPort}`,
  '--disable-gpu',
], {
  cwd: dirname(exePath),
  env: {
    ...process.env,
    APPDATA: resolve(appDataRoot, 'Roaming'),
    LOCALAPPDATA: resolve(appDataRoot, 'Local'),
    TEMP: resolve(appDataRoot, 'Temp'),
    TMP: resolve(appDataRoot, 'Temp'),
    CRADLE_E2E: '1',
    CRADLE_LOG_LEVEL: 'debug',
    CRADLE_LOG_SYNC: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const stdoutChunks = []
const stderrChunks = []
const consoleMessages = []
const pageErrors = []
const failedRequests = []
const httpErrors = []
child.stdout?.on('data', (chunk) => {
  stdoutChunks.push(Buffer.from(chunk))
  process.stdout.write(`[cradle.exe] ${chunk}`)
})
child.stderr?.on('data', (chunk) => {
  stderrChunks.push(Buffer.from(chunk))
  process.stderr.write(`[cradle.exe:err] ${chunk}`)
})

let browser
let page
try {
  await waitForCdp(remoteDebuggingPort, 60_000)
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`)
  const context = browser.contexts()[0]
  if (!context) {
    throw new Error('Connected to Electron CDP, but no browser context is available.')
  }
  page = await waitForPage(context, 30_000)

  page.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text() }
    consoleMessages.push(entry)
    console.log(`[renderer:${entry.type}] ${entry.text}`)
  })
  page.on('pageerror', (error) => {
    const entry = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) }
    pageErrors.push(entry)
    console.error('[renderer:pageerror]', error)
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()
    const entry = {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failureText: failure?.errorText ?? null,
    }
    failedRequests.push(entry)
    console.error(`[renderer:requestfailed] ${entry.method} ${entry.url}: ${entry.failureText ?? 'unknown failure'}`)
  })
  page.on('response', (response) => {
    if (response.status() < 400) {
      return
    }
    const entry = {
      url: response.url(),
      status: response.status(),
      statusText: response.statusText(),
      requestMethod: response.request().method(),
      resourceType: response.request().resourceType(),
    }
    httpErrors.push(entry)
    console.error(`[renderer:http${entry.status}] ${entry.requestMethod} ${entry.url}`)
  })

  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 })
  await page.waitForFunction(() => Boolean(globalThis.cradle?.env?.isElectron), undefined, { timeout: 30_000 })

  const desktopEnv = await page.evaluate(() => ({
    isElectron: globalThis.cradle?.env?.isElectron,
    platform: globalThis.cradle?.env?.platform,
    serverUrl: globalThis.cradle?.env?.serverUrl,
    href: location.href,
    pathname: location.pathname,
    title: document.title,
  }))

  if (desktopEnv.isElectron !== true) {
    throw new Error(`Expected Electron preload API, got ${JSON.stringify(desktopEnv)}`)
  }
  if (desktopEnv.platform !== 'win32') {
    throw new Error(`Expected win32 renderer platform, got ${desktopEnv.platform}`)
  }
  if (typeof desktopEnv.serverUrl !== 'string' || !desktopEnv.serverUrl.startsWith('http://127.0.0.1:')) {
    throw new Error(`Expected local desktop server URL, got ${desktopEnv.serverUrl}`)
  }

  const health = await waitForJson(`${desktopEnv.serverUrl}/health`, 60_000)
  await page.waitForFunction(() => document.body.textContent?.trim().length > 0, undefined, { timeout: 30_000 })

  const beforeOnboardingState = await capturePageState(page)
  console.log(`[packaged-e2e] before onboarding: ${JSON.stringify(beforeOnboardingState, null, 2)}`)
  if (!beforeOnboardingState.hasHomeDashboard && !beforeOnboardingState.hasAppSidebar) {
    await page.keyboard.press('Enter')
  }
  await waitForReadyAppContent(page, 60_000)

  const finalState = await capturePageState(page)
  console.log(`[packaged-e2e] final state: ${JSON.stringify(finalState, null, 2)}`)

  const stderrText = Buffer.concat(stderrChunks).toString('utf8')
  if (stderrText.includes('Socket server error') || stderrText.includes('listen EACCES')) {
    throw new Error(`Packaged app logged a browser backend socket failure:\n${stderrText}`)
  }

  const screenshotPath = resolve(artifactsDir, 'packaged-e2e-home.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })

  const result = {
    exePath,
    pid: child.pid,
    remoteDebuggingPort,
    desktopEnv,
    health,
    beforeOnboardingState,
    finalState,
    consoleMessages,
    pageErrors,
    failedRequests,
    httpErrors,
    screenshotPath,
  }
  writeFileSync(resolve(artifactsDir, 'packaged-e2e-result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`[packaged-e2e] passed: ${JSON.stringify(result, null, 2)}`)
}
catch (error) {
  if (page && !page.isClosed()) {
    const failureState = await capturePageState(page)
      .catch(err => ({ evaluationError: err instanceof Error ? err.message : String(err) }))
    const failureReport = {
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
      page: failureState,
      consoleMessages,
      pageErrors,
      failedRequests,
      httpErrors,
    }
    console.error(`[packaged-e2e] failure report: ${JSON.stringify(failureReport, null, 2)}`)
    writeFileSync(resolve(artifactsDir, 'packaged-e2e-failure.json'), `${JSON.stringify(failureReport, null, 2)}\n`, 'utf8')
    await page.screenshot({ path: resolve(artifactsDir, 'packaged-e2e-failure.png'), fullPage: true }).catch(() => {})
  }
  throw error
}
finally {
  if (page) {
    await page.close().catch(() => {})
  }
  if (browser) {
    await browser.close().catch(() => {})
  }
  await stopProcessTree(child)
  writeFileSync(resolve(artifactsDir, 'cradle-exe.stdout.log'), Buffer.concat(stdoutChunks))
  writeFileSync(resolve(artifactsDir, 'cradle-exe.stderr.log'), Buffer.concat(stderrChunks))
}

async function reserveAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to reserve a TCP port.')))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePort(port)
      })
    })
  })
}

async function waitForCdp(port, timeoutMs) {
  const endpoint = `http://127.0.0.1:${port}/json/version`
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Cradle.exe exited before CDP became ready. exitCode=${child.exitCode} signal=${child.signalCode}`)
    }
    try {
      const response = await fetch(endpoint)
      if (response.ok) {
        return
      }
    }
    catch {
      // Electron is still starting.
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for Electron CDP at ${endpoint}`)
}

async function waitForPage(context, timeoutMs) {
  const existing = context.pages().find(candidate => !candidate.isClosed())
  if (existing) {
    return existing
  }

  return new Promise((resolvePage, reject) => {
    let timeout
    const onPage = (nextPage) => {
      clearTimeout(timeout)
      context.off('page', onPage)
      resolvePage(nextPage)
    }
    timeout = setTimeout(() => {
      context.off('page', onPage)
      reject(new Error('Timed out waiting for Electron renderer page.'))
    }, timeoutMs)
    context.on('page', onPage)
  })
}

async function waitForJson(url, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return await response.json()
      }
    }
    catch {
      // Server is still starting.
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for JSON endpoint ${url}`)
}

async function waitForReadyAppContent(page, timeoutMs) {
  const selector = '[data-testid="home-dashboard"], [data-testid="app-sidebar"], [data-testid="chat-view"]'
  await page.waitForFunction((targetSelector) => {
    const hasVisibleMainSurface = Array.from(document.querySelectorAll(targetSelector)).some((element) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && rect.width > 0
        && rect.height > 0
    })
    if (hasVisibleMainSurface) {
      return true
    }

    const bodyText = document.body.textContent ?? ''
    return !location.hash.includes('/onboarding')
      && bodyText.length > 200
      && (bodyText.includes('Settings') || bodyText.includes('Providers') || bodyText.includes('New chat'))
  }, selector, { timeout: timeoutMs })
}

async function capturePageState(page) {
  return page.evaluate(() => {
    const targetSelector = '[data-testid="home-dashboard"], [data-testid="app-sidebar"], [data-testid="chat-view"]'
    const storageEntries = (storage) => {
      const entries = {}
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key) {
          entries[key] = storage.getItem(key)
        }
      }
      return entries
    }
    const describeElement = (element, index) => {
      const style = window.getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return {
        index,
        tagName: element.tagName,
        testId: element.getAttribute('data-testid'),
        className: element.getAttribute('class'),
        hidden: element.hasAttribute('hidden'),
        ariaHidden: element.getAttribute('aria-hidden'),
        textSample: element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) ?? '',
        style: {
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          pointerEvents: style.pointerEvents,
        },
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        visible: style.display !== 'none'
          && style.visibility !== 'hidden'
          && style.opacity !== '0'
          && rect.width > 0
          && rect.height > 0,
      }
    }
    return {
      href: location.href,
      hash: location.hash,
      pathname: location.pathname,
      search: location.search,
      title: document.title,
      readyState: document.readyState,
      bodyTextLength: document.body.textContent?.length ?? 0,
      bodyTextSample: document.body.textContent?.slice(0, 2000) ?? '',
      activeElement: document.activeElement
        ? {
            tagName: document.activeElement.tagName,
            testId: document.activeElement.getAttribute('data-testid'),
            textSample: document.activeElement.textContent?.replace(/\s+/g, ' ').trim().slice(0, 160) ?? '',
          }
        : null,
      hasHomeDashboard: Boolean(document.querySelector('[data-testid="home-dashboard"]')),
      hasAppSidebar: Boolean(document.querySelector('[data-testid="app-sidebar"]')),
      hasChatView: Boolean(document.querySelector('[data-testid="chat-view"]')),
      targetElements: Array.from(document.querySelectorAll(targetSelector)).map(describeElement),
      rootChildren: Array.from(document.body.children).slice(0, 12).map((element, index) => describeElement(element, index)),
      localStorage: storageEntries(localStorage),
      sessionStorage: storageEntries(sessionStorage),
    }
  })
}

async function stopProcessTree(proc) {
  if (!proc.pid) {
    return
  }
  await new Promise((resolveStop) => {
    const killer = spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    killer.once('exit', () => resolveStop())
    killer.once('error', () => resolveStop())
  })
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}
