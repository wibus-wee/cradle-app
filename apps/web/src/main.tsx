/* eslint-disable react-refresh/only-export-components */

import './styles.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import * as ReactJSXDevRuntime from 'react/jsx-dev-runtime'
import * as ReactJSXRuntime from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'

import { AppErrorBoundary } from './components/common/app-error-boundary'
import { resolveInitialLocale } from './i18n/browser-locale'
import { I18nProvider } from './i18n/client'
import { initPerfMonitor } from './lib/perf-monitor'
import { loadWebPlugins } from './lib/plugin-host'
import { initializeReactDiagnostics } from './lib/react-diagnostics'
import { installRendererDiagnostics } from './lib/renderer-diagnostics'

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

const AppRoot = React.lazy(async () => {
  const { App } = await import('./app')
  return { default: App }
})

const DevtoolRoot = React.lazy(async () => {
  const { DevtoolPage } = await import('./features/devtool/ipc-devtool-page')
  return { default: DevtoolPage }
})

function RootApplication() {
  const initialLocale = resolveInitialLocale()
  const Root = isDevtoolWindow ? DevtoolRoot : AppRoot

  return (
    <I18nProvider initialLocale={initialLocale}>
      <QueryClientProvider client={queryClient}>
        <React.Suspense fallback={<div className="h-screen w-screen bg-background" />}>
          <Root />
        </React.Suspense>
      </QueryClientProvider>
    </I18nProvider>
  )
}

function startApp(): void {
  ReactDOMClient.createRoot(document.getElementById('app')!).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <RootApplication />
      </AppErrorBoundary>
    </React.StrictMode>,
  )

  queueMicrotask(() => {
    initPerfMonitor()
    installRendererDiagnostics()
    void loadWebPlugins().catch((error) => {
      console.error('[plugin-host] failed to load web plugins:', error)
    })
  })
}

startApp()

queueMicrotask(() => {
  initializeReactDiagnostics()
})
