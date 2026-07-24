import type { ErrorComponentProps } from '@tanstack/react-router'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { RouteErrorView } from './route-error-view'

interface RouteErrorFallbackProps extends ErrorComponentProps {
  className?: string
}

export function RouteErrorFallback({
  className,
  error,
  reset,
}: RouteErrorFallbackProps) {
  const router = useRouter()
  const navigate = useNavigate()
  const { t } = useTranslation('common')
  const message = readErrorMessage(error) ?? t('routeError.unknownMessage')

  const retryRoute = useCallback(() => {
    reset()
    void router.invalidate().catch((invalidateError) => {
      console.error('Failed to invalidate route after error reset', invalidateError)
    })
  }, [reset, router])

  const navigateHome = useCallback(() => {
    reset()
    void navigate({ to: '/', replace: true }).catch((navigationError) => {
      console.error('Failed to navigate home after route error', navigationError)
    })
  }, [navigate, reset])

  return (
    <RouteErrorView
      className={className}
      title={t('routeError.title')}
      description={t('routeError.description')}
      messageLabel={t('routeError.messageLabel')}
      message={message}
      detailsLabel={t('errorBoundary.details')}
      details={import.meta.env.DEV && error instanceof Error ? error.stack : null}
      retryLabel={t('action.retry')}
      homeLabel={t('action.backToHome')}
      onRetry={retryRoute}
      onHome={navigateHome}
    />
  )
}

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }
  return null
}
