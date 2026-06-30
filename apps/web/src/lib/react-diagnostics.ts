const REACT_TOOLS_STORAGE_KEY = 'cradle:diagnostics:react-tools'
const REACT_SCAN_STORAGE_KEY = 'cradle:diagnostics:react-scan'
const REACT_GRAB_STORAGE_KEY = 'cradle:diagnostics:react-grab'
const DIAGNOSTICS_CHANGE_EVENT = 'cradle:diagnostics:react-tools-changed'

export interface ReactDiagnosticsApi {
  readEnabled: () => boolean
  setEnabled: (enabled: boolean) => void
  loadEnabledTools: () => void
  subscribe: (listener: () => void) => () => void
}

type ReactDiagnosticsWindow = Window & {
  __cradleReactDiagnostics?: ReactDiagnosticsApi
  __REACT_SCAN__?: unknown
  __REACT_SCAN_TOOLBAR_CONTAINER__?: HTMLElement
  reactScan?: unknown
  reactScanCleanupListeners?: unknown
}

const reactDiagnosticsApi: ReactDiagnosticsApi = {
  readEnabled,
  setEnabled,
  loadEnabledTools,
  subscribe,
}

function storageValueEnabled(storageKey: string): boolean {
  const value = window.localStorage.getItem(storageKey)
  return value === '1' || value === 'true'
}

function queryValueEnabled(flagName: string): boolean | null {
  const queryValue = new URLSearchParams(window.location.search).get(flagName)
  if (queryValue === null) {
    return null
  }

  return queryValue === '' || queryValue === '1' || queryValue === 'true'
}

function readEnabled(): boolean {
  return storageValueEnabled(REACT_TOOLS_STORAGE_KEY)
    || storageValueEnabled(REACT_SCAN_STORAGE_KEY)
    || storageValueEnabled(REACT_GRAB_STORAGE_KEY)
}

function writeEnabled(enabled: boolean): void {
  const storageKeys = [
    REACT_TOOLS_STORAGE_KEY,
    REACT_SCAN_STORAGE_KEY,
    REACT_GRAB_STORAGE_KEY,
  ]

  for (const storageKey of storageKeys) {
    if (enabled) {
      window.localStorage.setItem(storageKey, '1')
    }
    else {
      window.localStorage.removeItem(storageKey)
    }
  }
}

function loadReactScan(): void {
  if (!readEnabled()) {
    return
  }
  if (document.querySelector('script[data-cradle-react-scan]')) {
    return
  }

  const script = document.createElement('script')
  script.async = true
  script.crossOrigin = 'anonymous'
  script.src = 'https://unpkg.com/react-scan/dist/auto.global.js'
  script.dataset.cradleReactScan = 'true'
  document.head.append(script)
}

function loadReactGrab(): void {
  if (!import.meta.env.DEV || !readEnabled()) {
    return
  }

  void import('react-grab')
}

function loadEnabledTools(): void {
  loadReactScan()
  loadReactGrab()
}

function hasActiveReactDiagnosticsRuntime(): boolean {
  const diagnosticsWindow = window as ReactDiagnosticsWindow

  return Boolean(
    document.querySelector('script[data-cradle-react-scan]')
    || document.getElementById('react-scan-root')
    || document.getElementById('react-scan-toolbar-root')
    || document.querySelector('html > canvas[style*="2147483600"], body > canvas[style*="2147483600"]')
    || diagnosticsWindow.__REACT_SCAN__
    || diagnosticsWindow.__REACT_SCAN_TOOLBAR_CONTAINER__
    || diagnosticsWindow.reactScan
    || diagnosticsWindow.reactScanCleanupListeners,
  )
}

function reloadAfterDiagnosticsShutdown(): void {
  window.setTimeout(() => {
    window.location.reload()
  }, 0)
}

function dispatchDiagnosticsChange(): void {
  window.dispatchEvent(new Event(DIAGNOSTICS_CHANGE_EVENT))
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(DIAGNOSTICS_CHANGE_EVENT, listener)
  window.addEventListener('storage', listener)

  return () => {
    window.removeEventListener(DIAGNOSTICS_CHANGE_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

function setEnabled(enabled: boolean): void {
  const needsReload = !enabled && hasActiveReactDiagnosticsRuntime()

  writeEnabled(enabled)
  dispatchDiagnosticsChange()

  if (enabled) {
    loadEnabledTools()
    return
  }

  if (needsReload) {
    reloadAfterDiagnosticsShutdown()
  }
}

function applyStartupFlags(): void {
  const unifiedFlag = queryValueEnabled('reactTools')
  const scanFlag = queryValueEnabled('reactScan')
  const grabFlag = queryValueEnabled('reactGrab')

  if (unifiedFlag !== null) {
    writeEnabled(unifiedFlag)
    return
  }

  if (scanFlag === true || grabFlag === true) {
    writeEnabled(true)
  }
}

export function initializeReactDiagnostics(): void {
  const diagnosticsWindow = window as ReactDiagnosticsWindow

  if (!diagnosticsWindow.__cradleReactDiagnostics) {
    diagnosticsWindow.__cradleReactDiagnostics = reactDiagnosticsApi
  }

  applyStartupFlags()
  loadEnabledTools()
}

export function getReactDiagnosticsApi(): ReactDiagnosticsApi {
  const diagnosticsWindow = window as ReactDiagnosticsWindow
  return diagnosticsWindow.__cradleReactDiagnostics ?? reactDiagnosticsApi
}
