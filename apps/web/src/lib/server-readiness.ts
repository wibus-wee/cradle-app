import { cradleFetch } from './server-credential'
import { getConfiguredServerUrl, setRuntimeServerUrl } from './server-endpoint-preferences'

type DesktopServerStatus
  = | { state: 'starting' }
    | { state: 'migrating', phase: string }
    | { state: 'compacting' }
    | { state: 'ready', serverUrl: string }
    | { state: 'failed', message: string }

const HEALTH_RETRY_DELAYS_MS = [200, 400, 800, 1_000] as const

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, delayMs))
}

async function waitForHostedServer(): Promise<string> {
  const serverUrl = getConfiguredServerUrl()
  let attempt = 0

  while (true) {
    try {
      const response = await cradleFetch(new URL('/health', serverUrl))
      if (response.ok) {
        return serverUrl
      }
    }
    catch {
      // The server is still starting or temporarily unreachable.
    }

    const delayMs = HEALTH_RETRY_DELAYS_MS[Math.min(attempt, HEALTH_RETRY_DELAYS_MS.length - 1)]
    attempt += 1
    await wait(delayMs)
  }
}

function waitForDesktopServer(): Promise<string> {
  const runtime = window.cradle?.serverRuntime
  if (!runtime) {
    return Promise.reject(new Error('Desktop server readiness bridge is unavailable.'))
  }

  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = () => {}

    const handleStatus = (status: DesktopServerStatus) => {
      updateBootstrapStatus(status)
      if (settled || status.state === 'starting' || status.state === 'migrating' || status.state === 'compacting') {
        return
      }
      settled = true
      unsubscribe()

      if (status.state === 'failed') {
        reject(new Error(status.message))
        return
      }

      setRuntimeServerUrl(status.serverUrl)
      resolve(getConfiguredServerUrl())
    }

    const unsubscribeStatus = runtime.onStatusChanged(handleStatus)
    unsubscribe = unsubscribeStatus
    if (settled) {
      unsubscribeStatus()
    }
    void runtime.getStatus().then(handleStatus, reject)
  })
}

function updateBootstrapStatus(status: DesktopServerStatus): void {
  const message = document.querySelector<HTMLElement>('[data-bootstrap-message]')
  if (!message) {
    return
  }
  if (status.state === 'migrating') {
    message.textContent = 'Preparing your data…'
  }
  else if (status.state === 'compacting') {
    message.textContent = 'Making a little room…'
  }
  else if (status.state === 'starting') {
    message.textContent = 'Opening Cradle…'
  }
}

export function waitForServer(): Promise<string> {
  return window.cradle?.env.isElectron
    ? waitForDesktopServer()
    : waitForHostedServer()
}
