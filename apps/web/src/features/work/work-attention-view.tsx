import {
  AlertLine as AlertIcon,
  ArrowRightLine as ArrowRightIcon,
  CheckCircleLine as ReviewIcon,
  QuestionLine as QuestionIcon,
  Refresh2Line as RefreshIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

import type { WorkAttentionItem } from './use-work'
import { formatAttentionWaiting } from './work-attention-format'

export interface WorkAttentionViewProps {
  items: readonly WorkAttentionItem[]
  isReady: boolean
  hasError: boolean
  redetectingWorkId?: string | null
  onOpenWork: (workId: string) => void
  onRedetect: (workId: string) => void
}

const categoryIcon = {
  approve_or_answer: QuestionIcon,
  handle_failure: AlertIcon,
  review_work: ReviewIcon,
  merge_or_archive: ArrowRightIcon,
} as const

const categoryLabelKey = {
  approve_or_answer: 'category.approveOrAnswer',
  handle_failure: 'category.handleFailure',
  review_work: 'category.reviewWork',
  merge_or_archive: 'category.mergeOrArchive',
} as const

const authorityLabelKey = {
  official_hook: 'authority.officialHook',
  runtime_integration: 'authority.runtimeIntegration',
  terminal_recognizer: 'authority.terminalRecognizer',
  user_override: 'authority.userOverride',
  derived: 'authority.derived',
} as const

const recoveryLabelKey = {
  live: 'recovery.live',
  resumable: 'recovery.resumable',
  restorable: 'recovery.restorable',
  reproducible: 'recovery.reproducible',
  unknown: 'recovery.unknown',
} as const

const riskClasses = {
  high: 'border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400',
  medium: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  low: 'border-border/60 bg-fill/20 text-muted-foreground',
} as const

export function WorkAttentionView({
  items,
  isReady,
  hasError,
  redetectingWorkId = null,
  onOpenWork,
  onRedetect,
}: WorkAttentionViewProps) {
  const { t } = useTranslation('awaits')

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden bg-background"
      data-testid="work-attention"
      data-attention-ready={isReady ? 'true' : 'false'}
    >
      <div className="shrink-0 border-b border-border/50 px-5 py-4">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold text-foreground">{t('overview.title')}</h1>
          {items.length > 0 && (
            <span className="rounded-full bg-fill px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {items.length}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t('overview.description')}</p>
      </div>

      {items.length === 0
        ? (
            <Empty className={cn('border-0', hasError && 'text-destructive')}>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {isReady ? <ReviewIcon /> : hasError ? <AlertIcon /> : <Spinner />}
                </EmptyMedia>
                <EmptyTitle>{hasError ? t('error.title') : t('empty.title')}</EmptyTitle>
                <EmptyDescription>
                  {hasError ? t('error.description') : t('empty.description')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mx-auto flex max-w-4xl flex-col gap-2">
                {items.map((item) => {
                  const CategoryIcon = categoryIcon[item.category]
                  const redetecting = redetectingWorkId === item.workId
                  return (
                    <article
                      key={item.id}
                      className="group rounded-lg border border-border/60 bg-card p-3 shadow-xs transition-colors hover:border-border"
                      data-testid={`attention-item-${item.workId}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn('mt-0.5 rounded-md border p-1.5', riskClasses[item.risk])}>
                          <CategoryIcon className="size-4" aria-hidden="true" />
                        </div>
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => onOpenWork(item.workId)}
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">{item.workTitle}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {formatAttentionWaiting(item.waitingSeconds)}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {item.reason}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground/80">
                            <span>{t(categoryLabelKey[item.category])}</span>
                            <span aria-hidden="true">·</span>
                            <span>{item.runtimeKind}</span>
                            <span aria-hidden="true">·</span>
                            <span>{t(authorityLabelKey[item.authority])}</span>
                            <span aria-hidden="true">·</span>
                            <span>{t(recoveryLabelKey[item.recovery.level])}</span>
                          </div>
                          <p className="mt-2 text-[11px] font-medium text-foreground/80">{item.nextAction}</p>
                        </button>
                        {(item.state === 'failed' || item.state === 'unknown') && (
                          <button
                            type="button"
                            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-fill hover:text-foreground disabled:opacity-50"
                            disabled={redetecting}
                            onClick={() => onRedetect(item.workId)}
                            aria-label={t('action.redetect')}
                            title={t('action.redetect')}
                          >
                            {redetecting ? <Spinner className="size-3.5" /> : <RefreshIcon className="size-3.5" />}
                          </button>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          )}
    </div>
  )
}
