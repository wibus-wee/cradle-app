import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  clearCustomServerUrl,
  getConfiguredServerUrl,
  normalizeServerEndpointUrl,
  readCustomServerUrl,
  writeCustomServerUrl,
} from '~/lib/server-endpoint-preferences'
import { probeServerHealth } from '~/lib/server-health'

import type { ServerConnectionStatus } from './server-connection-recovery-view'
import { ServerConnectionRecoveryView } from './server-connection-recovery-view'

const CONNECTION_TEST_TIMEOUT_MS = 4_000

export function ServerConnectionRecovery({ error }: { error: Error | null }) {
  const { t } = useTranslation('settings')
  const [endpoint] = useState(() => getConfiguredServerUrl())
  const [hasCustomEndpoint] = useState(() => readCustomServerUrl() !== null)
  const [draftEndpoint, setDraftEndpoint] = useState(endpoint)
  const [validationError, setValidationError] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [status, setStatus] = useState<ServerConnectionStatus>({ kind: 'idle' })
  const canConfigureEndpoint = !window.cradle?.env.isElectron

  function getNormalizedDraft(): string | null {
    try {
      const normalized = normalizeServerEndpointUrl(draftEndpoint)
      setValidationError(false)
      return normalized
    }
    catch {
      setValidationError(true)
      return null
    }
  }

  async function check(url: string): Promise<boolean> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), CONNECTION_TEST_TIMEOUT_MS)
    setStatus({ kind: 'checking' })
    const result = await probeServerHealth(url, { signal: controller.signal })
    window.clearTimeout(timeout)

    if (result.kind === 'healthy') {
      setStatus({ kind: 'success', message: t('serverEndpoint.test.success') })
      return true
    }
    setStatus({
      kind: 'error',
      message: result.kind === 'http-error'
        ? t('serverEndpoint.test.httpError', { status: result.status })
        : t('serverEndpoint.test.unreachable'),
    })
    return false
  }

  async function connect(): Promise<void> {
    const normalized = getNormalizedDraft()
    if (!normalized) {
      return
    }
    if (!await check(normalized)) {
      return
    }
    writeCustomServerUrl(normalized)
    window.location.reload()
  }

  async function testConnection(): Promise<void> {
    const normalized = getNormalizedDraft()
    if (normalized) {
      await check(normalized)
    }
  }

  async function retry(): Promise<void> {
    setRetrying(true)
    if (await check(endpoint)) {
      window.location.reload()
      return
    }
    setRetrying(false)
  }

  return (
    <ServerConnectionRecoveryView
      labels={{
        title: t('serverEndpoint.recovery.title'),
        hostedDescription: t('serverEndpoint.recovery.hostedDescription'),
        desktopDescription: t('serverEndpoint.recovery.desktopDescription'),
        endpointLabel: t('serverEndpoint.url.label'),
        endpointHint: t('serverEndpoint.recovery.endpointHint'),
        invalidEndpoint: t('serverEndpoint.error.invalidUrl'),
        retry: t('serverEndpoint.recovery.retry'),
        retrying: t('serverEndpoint.recovery.retrying'),
        test: t('serverEndpoint.action.test'),
        testing: t('serverEndpoint.action.testing'),
        connect: t('serverEndpoint.recovery.connect'),
        useDefault: t('serverEndpoint.action.reset'),
        securityNote: t('serverEndpoint.recovery.securityNote'),
        details: t('serverEndpoint.recovery.details'),
      }}
      endpoint={endpoint}
      draftEndpoint={draftEndpoint}
      canConfigureEndpoint={canConfigureEndpoint}
      hasCustomEndpoint={hasCustomEndpoint}
      validationError={validationError}
      retrying={retrying}
      status={status}
      errorDetail={error?.message ?? null}
      onDraftEndpointChange={(value) => {
        setDraftEndpoint(value)
        setValidationError(false)
        setStatus({ kind: 'idle' })
      }}
      onRetry={() => void retry()}
      onTestConnection={() => void testConnection()}
      onConnect={() => void connect()}
      onUseDefault={() => {
        clearCustomServerUrl()
        window.location.reload()
      }}
    />
  )
}
