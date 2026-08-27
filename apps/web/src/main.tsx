import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import * as ReactJSXDevRuntime from 'react/jsx-dev-runtime'
import * as ReactJSXRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'

import { AppErrorBoundary } from './components/common/app-error-boundary'
import { resolveInitialLocale } from './i18n/browser-locale'
import { I18nProvider } from './i18n/client'
import { waitForServer } from './lib/server-readiness'

// Expose shared React modules for plugin runtime
// Plugins loaded via dynamic import() need access to the SAME React instance
Object.defineProperty(window, Symbol.for('cradle:modules'), {
  configurable: true,
  value: {
    'react': React,
    'react-dom': ReactDOM,
    'react-dom/client': ReactDOMClient,
    'react/jsx-dev-runtime': ReactJSXDevRuntime,
    'react/jsx-runtime': ReactJSXRuntime,
  },
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

// Hash-based routing: #devtool renders the devtool page (Electron second window)
const isDevtoolWindow = window.location.hash === '#devtool' || window.location.hash === '#/devtool'
const initialLocale = resolveInitialLocale()
const applicationPromise: Promise<React.ComponentType> = isDevtoolWindow
  ? import('./features/devtool/ipc-devtool-page').then(module => module.DevtoolPage)
  : import('./app').then(module => module.App)
const stylesheetPromise = import('./styles.css')
const root = ReactDOMClient.createRoot(document.getElementById('app')!)

function renderBootstrapFallback(error: unknown): void {
  const message = document.querySelector<HTMLElement>('[data-bootstrap-message]')
  document.getElementById('bootstrap-shell')?.classList.add('is-failed')
  if (message) {
    message.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function showBootstrapError(error: unknown): Promise<void> {
  try {
    const [{ ServerConnectionRecovery }] = await Promise.all([
      import('./features/server-connection/server-connection-recovery'),
      stylesheetPromise,
    ])
    root.render(
      <React.StrictMode>
        <AppErrorBoundary>
          <I18nProvider initialLocale={initialLocale}>
            <ServerConnectionRecovery error={error instanceof Error ? error : new Error(String(error))} />
          </I18nProvider>
        </AppErrorBoundary>
      </React.StrictMode>,
    )
  }
  catch (recoveryError) {
    renderBootstrapFallback(recoveryError)
  }
}

async function startApp(): Promise<void> {
  const [RootApplication] = await Promise.all([
    applicationPromise,
    waitForServer(),
    stylesheetPromise,
  ])
  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <I18nProvider initialLocale={initialLocale}>
          <QueryClientProvider client={queryClient}>
            <RootApplication />
          </QueryClientProvider>
        </I18nProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  )

  queueMicrotask(() => {
    void Promise.all([
      import('./lib/perf-monitor'),
      import('./lib/plugin-host'),
      import('./lib/react-diagnostics'),
      import('./lib/renderer-diagnostics'),
    ])
      .then(async ([perfMonitor, pluginHost, reactDiagnostics, rendererDiagnostics]) => {
        perfMonitor.initPerfMonitor()
        reactDiagnostics.initializeReactDiagnostics()
        rendererDiagnostics.installRendererDiagnostics()
        await pluginHost.loadWebPlugins()
        await pluginHost.startPluginDevSessionWatcher()
      })
      .catch((error) => {
        console.error('[bootstrap] post-render startup failed:', error)
      })
  })
}

void startApp().catch(error => void showBootstrapError(error))
