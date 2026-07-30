import {
  ExternalLinkLine as ExternalLinkIcon,
  GitPullRequestLine as PullRequestIcon,
  Refresh1Line as RefreshIcon,
  Settings3Line as SettingsIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { cn } from '~/lib/cn'
import { openSettingsSection } from '~/navigation/navigation-commands'

import type { PullRequestErrorKind } from './pull-request-error'

export interface PullRequestErrorStateViewProps {
  kind: PullRequestErrorKind
  className?: string
  retrying?: boolean
  onRetry?: () => void
}

export function PullRequestErrorStateView({
  kind,
  className,
  retrying = false,
  onRetry,
}: PullRequestErrorStateViewProps) {
  const { t } = useTranslation('pull-requests')
  const titleKey = `errors.${kind}.title` as const
  const descriptionKey = `errors.${kind}.description` as const

  return (
    <Empty className={cn('h-full border-0', className)} data-testid={`pull-request-error-${kind}`}>
      <EmptyHeader>
        <EmptyMedia variant="icon"><PullRequestIcon /></EmptyMedia>
        <EmptyTitle>{t(titleKey)}</EmptyTitle>
        <EmptyDescription>{t(descriptionKey)}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        {kind === 'cli-auth-required'
          ? (
              <Button variant="outline" size="sm" asChild>
                <a href="https://cli.github.com/" target="_blank" rel="noreferrer">
                  <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                  {t('errors.cli-auth-required.installCli')}
                </a>
              </Button>
            )
          : null}
        {kind === 'app-connection-expired' || kind === 'app-unconfigured'
          ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openSettingsSection('integrations')}
              >
                <SettingsIcon className="size-3.5" aria-hidden="true" />
                {t('errors.openSettings')}
              </Button>
            )
          : null}
        {kind === 'repository-access-unavailable' || kind === 'repository-access-denied'
          ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openSettingsSection('integrations')}
              >
                <SettingsIcon className="size-3.5" aria-hidden="true" />
                {t('errors.openSettings')}
              </Button>
            )
          : null}
        {onRetry
          ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={retrying}
              >
                <RefreshIcon className={cn('size-3.5', retrying && 'animate-spin')} aria-hidden="true" />
                {t('errors.retry')}
              </Button>
            )
          : null}
      </EmptyContent>
    </Empty>
  )
}
