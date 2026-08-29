import { QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import * as ReactDOMClient from 'react-dom/client'

import { AppErrorBoundary } from '~/components/common/app-error-boundary'
import { resolveInitialLocale } from '~/i18n/browser-locale'
import { I18nProvider } from '~/i18n/client'
import { queryClient } from '~/lib/query-client'
import { waitForServer } from '~/lib/server-readiness'

const initialLocale = resolveInitialLocale()
const applicationPromise = import('~/app').then(module => module.App)
const chatViewPromise = import('~/features/chat/chat-view')
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
      import('~/features/server-connection/server-connection-recovery'),
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

async function startTearoffApp(): Promise<void> {
  const [App] = await Promise.all([
    applicationPromise,
    chatViewPromise,
    waitForServer(),
    stylesheetPromise,
  ])
  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <I18nProvider initialLocale={initialLocale}>
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </I18nProvider>
      </AppErrorBoundary>
    </React.StrictMode>,
  )

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      window.cradle?.tearoff?.notifyRendererReady()
    })
  })

  queueMicrotask(() => {
    void import('~/lib/perf-monitor').then(({ initPerfMonitor }) => {
      initPerfMonitor()
    })
  })
}

void startTearoffApp().catch(error => void showBootstrapError(error))
