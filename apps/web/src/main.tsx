import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import * as ReactJSXDevRuntime from 'react/jsx-dev-runtime'
import * as ReactJSXRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'

import { AppErrorBoundary } from './components/common/app-error-boundary'
import { resolveInitialLocale } from './i18n/browser-locale'
import { I18nProvider } from './i18n/client'
import { bootstrapBrowserAuthSession } from './lib/server-credential'
import { waitForServer } from './lib/server-readiness'

type SharedModuleRegistry = Window & {
  [key: symbol]: Record<string, unknown>
}

// Expose shared React modules for plugin runtime
// Plugins loaded via dynamic import() need access to the SAME React instance
const sharedModuleRegistry = window as unknown as SharedModuleRegistry
sharedModuleRegistry[Symbol.for('cradle:modules')] = {
  'react': React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-dev-runtime': ReactJSXDevRuntime,
  'react/jsx-runtime': ReactJSXRuntime,
}

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

function showBootstrapError(error: unknown): void {
  const shell = document.getElementById('bootstrap-shell')
  const message = shell?.querySelector<HTMLElement>('[data-bootstrap-message]')
  shell?.classList.add('is-failed')
  if (message) {
    message.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function startApp(): Promise<void> {
  const [RootApplication, serverUrl] = await Promise.all([
    applicationPromise,
    waitForServer(),
    stylesheetPromise,
  ])
  const authPromise = bootstrapBrowserAuthSession(serverUrl)

  ReactDOMClient.createRoot(document.getElementById('app')!).render(
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
        await authPromise
        await pluginHost.loadWebPlugins()
      })
      .catch((error) => {
        console.error('[bootstrap] post-render startup failed:', error)
      })
  })
}

void startApp().catch(showBootstrapError)
