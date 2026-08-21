import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import * as ReactDOMClient from 'react-dom/client'

import { AppErrorBoundary } from '~/components/common/app-error-boundary'
import { resolveInitialLocale } from '~/i18n/browser-locale'
import { I18nProvider } from '~/i18n/client'
import { waitForServer } from '~/lib/server-readiness'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const initialLocale = resolveInitialLocale()
const applicationPromise = import('~/app').then(module => module.App)
const stylesheetPromise = import('./styles.css')

function showBootstrapError(error: unknown): void {
  const shell = document.getElementById('bootstrap-shell')
  const message = shell?.querySelector<HTMLElement>('[data-bootstrap-message]')
  shell?.classList.add('is-failed')
  if (message) {
    message.textContent = error instanceof Error ? error.message : String(error)
  }
}

async function startTearoffApp(): Promise<void> {
  const [App] = await Promise.all([
    applicationPromise,
    waitForServer(),
    stylesheetPromise,
  ])
  ReactDOMClient.createRoot(document.getElementById('app')!).render(
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

  queueMicrotask(() => {
    void import('~/lib/perf-monitor').then(({ initPerfMonitor }) => {
      initPerfMonitor()
    })
  })
}

void startTearoffApp().catch(showBootstrapError)
