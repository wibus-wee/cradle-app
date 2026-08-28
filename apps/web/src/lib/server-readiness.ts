import { client } from './client.config'
import { getServerUrl } from './electron'
import { cradleFetch } from './server-credential'
import { getConfiguredServerUrl } from './server-endpoint-preferences'
import { probeServerHealth } from './server-health'
import type { DesktopServerConnectionProjection } from './server-transport/base-url'
import {
  applyDesktopServerReadyEndpoint,
} from './server-transport/base-url'

type DesktopServerStatus
  = | { state: 'starting' }
    | { state: 'migrating', phase: string }
    | { state: 'bootstrapping', bootstrap: DesktopServerBootstrapSnapshot }
    | {
      state: 'ready'
      serverUrl: string
      bootstrap: DesktopServerBootstrapSnapshot
      /** Absent on older Desktop builds — fall back to HTTP(S) serverUrl. */
      connection?: DesktopServerConnectionProjection
    }
    | { state: 'failed', message: string, bootstrap: DesktopServerBootstrapSnapshot | null }

type DesktopServerBootstrapSnapshot = {
  currentPhase:
    | 'database-migration'
    | 'database-maintenance'
    | 'persisted-run-recovery'
    | 'service-initialization'
    | 'plugin-activation'
    | 'listener-establishment'
    | null
  phaseStartedAt: string | null
}

const HEALTH_RETRY_DELAYS_MS = [200, 400, 800, 1_000] as const
const HOSTED_SERVER_TIMEOUT_MS = 4_000

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, delayMs))
}

export async function waitForHostedServer(): Promise<string> {
  const serverUrl = getConfiguredServerUrl()
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), HOSTED_SERVER_TIMEOUT_MS)

  try {
    for (const delayMs of HEALTH_RETRY_DELAYS_MS) {
      const result = await probeServerHealth(serverUrl, {
        fetcher: cradleFetch,
        signal: controller.signal,
      })
      if (result.kind === 'healthy') {
        return serverUrl
      }
      if (controller.signal.aborted) {
        break
      }
      await wait(delayMs)
    }

    const finalResult = await probeServerHealth(serverUrl, {
      fetcher: cradleFetch,
      signal: controller.signal,
    })
    if (finalResult.kind === 'healthy') {
      return serverUrl
    }
    throw new Error(`Could not reach Cradle Server at ${serverUrl}.`)
  }
  finally {
    window.clearTimeout(timeout)
  }
}

export async function waitForDesktopServer(): Promise<string> {
  const runtime = window.cradle?.serverRuntime
  if (!runtime) {
    throw new Error('Desktop server readiness bridge is unavailable.')
  }

  const initialStatus = await runtime.getStatus()
  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = () => {}

    const handleStatus = (status: DesktopServerStatus) => {
      updateBootstrapStatus(status)
      if (
        settled
        || status.state === 'starting'
        || status.state === 'migrating'
        || status.state === 'bootstrapping'
      ) {
        return
      }
      settled = true
      unsubscribe()

      if (status.state === 'failed') {
        reject(new Error(status.message))
        return
      }

      applyDesktopServerReadyEndpoint({
        serverUrl: status.serverUrl,
        connection: status.connection ?? null,
      })
      // Keep the generated client baseUrl aligned after Desktop publishes ready.
      client.setConfig({ baseUrl: getServerUrl() })
      resolve(getServerUrl())
    }

    // Snapshot first: a renderer may attach after the server emitted ready.
    handleStatus(initialStatus)
    if (settled) {
      return
    }
    unsubscribe = runtime.onStatusChanged(handleStatus)
    // Close the snapshot/subscribe race; updates remain event-driven afterward.
    void runtime.getStatus().then(handleStatus, reject)
  })
}

function updateBootstrapStatus(status: DesktopServerStatus): void {
  // Node/unit tests have no DOM; production renderer always has document.
  if (typeof document === 'undefined') {
    return
  }
  const message = document.querySelector<HTMLElement>('[data-bootstrap-message]')
  if (!message) {
    return
  }
  if (
    status.state === 'migrating'
    || (status.state === 'bootstrapping' && status.bootstrap.currentPhase === 'database-migration')
  ) {
    message.textContent = 'Preparing your data…'
  }
  else if (
    status.state === 'bootstrapping'
    && status.bootstrap.currentPhase === 'database-maintenance'
  ) {
    message.textContent = 'Making a little room…'
  }
  else if (
    status.state === 'bootstrapping'
    && status.bootstrap.currentPhase === 'persisted-run-recovery'
  ) {
    message.textContent = 'Restoring your work…'
  }
  else if (
    status.state === 'bootstrapping'
    && status.bootstrap.currentPhase === 'plugin-activation'
  ) {
    message.textContent = 'Starting extensions…'
  }
  else if (status.state === 'starting') {
    message.textContent = 'Opening Cradle…'
  }
}

export function waitForServer(): Promise<string> {
  return window.cradle?.env.isElectron ? waitForDesktopServer() : waitForHostedServer()
}
