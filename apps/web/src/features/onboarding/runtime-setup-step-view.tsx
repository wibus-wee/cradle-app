import {
  CheckCircleLine as CheckIcon,
  DownloadLine as DownloadIcon,
  DriveLine as ModelIcon,
  Refresh1Line as RetryIcon,
  TerminalBoxLine as GenericRuntimeIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import { useTranslation } from 'react-i18next'

import type { RuntimeIconDescriptor } from '~/components/common/provider-icons'
import { RuntimeIcon } from '~/components/common/provider-icons'
import { Button } from '~/components/ui/button'
import { Progress } from '~/components/ui/progress'
import type { DownloadTask } from '~/features/download-center/types'
import type { ManagedResource } from '~/features/managed-resources/projection'
import {
  managedResourceKey,
  projectResourceTransferProgress,
} from '~/features/managed-resources/projection'
import { formatCompactBytes } from '~/lib/number-format'

export interface OnboardingRuntimeItem {
  resource: ManagedResource
  tasks: readonly DownloadTask[]
  /** Brand mark; falls back to a generic kind icon when absent. */
  icon?: RuntimeIconDescriptor
}

export interface OnboardingRuntimesStepViewProps {
  items: readonly OnboardingRuntimeItem[]
  /** Key of the resource whose install/update dispatch is in flight. */
  pendingKey?: string | null
  onInstall: (resource: ManagedResource) => void
}

function ItemIcon({ item, className }: { item: OnboardingRuntimeItem, className?: string }) {
  if (item.icon) {
    return <RuntimeIcon icon={item.icon} className={className} />
  }
  const Fallback = item.resource.kind === 'model' ? ModelIcon : GenericRuntimeIcon
  return <Fallback className={className} aria-hidden="true" />
}

interface RowModel {
  installing: boolean
  percent: number | null
  statusLine: string | null
  failed: boolean
}

function useRowModel(item: OnboardingRuntimeItem): RowModel {
  const { t } = useTranslation('onboarding')
  const progress = projectResourceTransferProgress(item.tasks)
  const installing = progress.activeTasks.length > 0 || item.resource.state === 'installing'
  const active = progress.activeTasks[0] ?? null
  const statusLine = active === null
    ? null
    : active.status === 'queued'
      ? t('setup.runtimes.queued')
      : active.status === 'verifying'
        ? t('setup.runtimes.verifying')
        : progress.totalBytes === null
          ? formatCompactBytes(progress.transferredBytes)
          : `${formatCompactBytes(progress.transferredBytes)} / ${formatCompactBytes(progress.totalBytes)}`
  return {
    installing,
    percent: progress.percent,
    statusLine,
    failed: progress.failedTask !== null && item.resource.state !== 'installed',
  }
}

function StateGlyph() {
  // Contextual swap: scale 0.25→1 + blur 4→0, spring with no bounce.
  return (
    <m.span
      className="flex size-5 items-center justify-center rounded-full bg-success/10 text-success"
      initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
    >
      <CheckIcon className="size-3" aria-hidden="true" />
    </m.span>
  )
}

function RequiredRuntimeCard({
  item,
  index,
  pending,
  onInstall,
}: {
  item: OnboardingRuntimeItem
  index: number
  pending: boolean
  onInstall: (resource: ManagedResource) => void
}) {
  const { t } = useTranslation('onboarding')
  const { resource } = item
  const model = useRowModel(item)
  const installed = resource.state === 'installed'

  return (
    <m.article
      className="rounded-xl border border-border/60 bg-card px-4 py-3.5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1], delay: 0.05 + index * 0.06 }}
      data-testid={`onboarding-runtime-${managedResourceKey(resource)}`}
    >
      <div className="flex items-start gap-3.5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted text-muted-foreground">
          <ItemIcon item={item} className="size-4.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13.5px] font-medium text-foreground">
              {resource.displayName}
            </span>
            <span className="rounded-md bg-fill px-1.5 py-px text-[10.5px] text-muted-foreground">
              {t('setup.runtimes.required')}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-pretty text-muted-foreground">
            {resource.description}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {installed
            ? (
                <span className="flex items-center gap-1.5 text-[12px] text-success">
                  <StateGlyph />
                  {t('setup.runtimes.installed')}
                </span>
              )
            : model.installing
              ? (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {model.percent === null ? '' : `${model.percent}%`}
                  </span>
                )
              : model.failed || resource.state === 'error'
                ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 px-2.5 text-[12px] active:scale-[0.96]"
                      disabled={pending}
                      onClick={() => onInstall(resource)}
                    >
                      <RetryIcon data-icon="inline-start" />
                      {t('setup.runtimes.retry')}
                    </Button>
                  )
                : (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 gap-1.5 px-3 text-[12px] active:scale-[0.96]"
                      disabled={pending || !resource.actions.install.available}
                      onClick={() => onInstall(resource)}
                    >
                      <DownloadIcon data-icon="inline-start" />
                      {t('setup.runtimes.install')}
                    </Button>
                  )}
        </div>
      </div>

      {model.installing
        ? (
            <div className="mt-3 pl-13.5">
              <Progress value={model.percent ?? 8} className="h-1" />
              <div className="mt-1.5 flex items-center justify-between font-mono text-[10.5px] tabular-nums text-muted-foreground">
                <span>{model.statusLine}</span>
                {resource.downloadSizeBytes !== null
                  ? <span>{formatCompactBytes(resource.downloadSizeBytes)}</span>
                  : null}
              </div>
            </div>
          )
        : null}

      {model.failed
        ? (
            <p className="mt-2 pl-13.5 text-[11.5px] text-destructive">
              {t('setup.runtimes.failed')}
            </p>
          )
        : null}
    </m.article>
  )
}

function OptionalRuntimeRow({
  item,
  index,
  pending,
  onInstall,
}: {
  item: OnboardingRuntimeItem
  index: number
  pending: boolean
  onInstall: (resource: ManagedResource) => void
}) {
  const { t } = useTranslation('onboarding')
  const { resource } = item
  const model = useRowModel(item)
  const installed = resource.state === 'installed'

  return (
    <m.div
      className="rounded-lg px-1 py-1"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1], delay: 0.12 + index * 0.06 }}
      data-testid={`onboarding-runtime-${managedResourceKey(resource)}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted text-muted-foreground">
          <ItemIcon item={item} className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-foreground">
              {resource.displayName}
            </span>
            {installed ? <StateGlyph /> : null}
          </div>
          <p className="truncate text-[11px] text-muted-foreground/80">
            {resource.description}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {installed
            ? null
            : model.installing
              ? (
                  <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {model.percent === null ? '' : `${model.percent}%`}
                  </span>
                )
              : resource.state === 'unavailable'
                ? (
                    <span className="text-[11px] text-muted-foreground/60">
                      {t('setup.runtimes.unavailable')}
                    </span>
                  )
                : model.failed
                  ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6.5 gap-1 px-2 text-[11.5px] active:scale-[0.96]"
                        disabled={pending}
                        onClick={() => onInstall(resource)}
                      >
                        <RetryIcon data-icon="inline-start" />
                        {t('setup.runtimes.retry')}
                      </Button>
                    )
                  : (
                      <>
                        {resource.downloadSizeBytes !== null
                          ? (
                              <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
                                {formatCompactBytes(resource.downloadSizeBytes)}
                              </span>
                            )
                          : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6.5 gap-1 px-2.5 text-[11.5px] active:scale-[0.96]"
                          disabled={pending || !resource.actions.install.available}
                          onClick={() => onInstall(resource)}
                        >
                          {t('setup.runtimes.add')}
                        </Button>
                      </>
                    )}
        </div>
      </div>

      {model.installing
        ? (
            <div className="mt-1.5 pl-11 pr-1">
              <Progress value={model.percent ?? 8} className="h-[3px]" />
              <p className="mt-1 font-mono text-[10px] tabular-nums text-muted-foreground/70">
                {model.statusLine}
              </p>
            </div>
          )
        : null}

      {model.failed
        ? (
            <p className="mt-1 pl-11 text-[11px] text-destructive">
              {t('setup.runtimes.failed')}
            </p>
          )
        : null}
    </m.div>
  )
}

/**
 * Content view for the first-run "Set up your runtimes" step. The surrounding
 * dialog shell owns the step chrome and footer; this view renders the managed
 * runtime inventory — required entries as hero cards, optional entries as
 * compact rows — joined with live Download Center transfers.
 */
export function OnboardingRuntimesStepView({
  items,
  pendingKey = null,
  onInstall,
}: OnboardingRuntimesStepViewProps) {
  const { t } = useTranslation('onboarding')
  const required = items.filter(item => item.resource.required)
  const optional = items.filter(item => !item.resource.required)

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        {required.map((item, index) => (
          <RequiredRuntimeCard
            key={managedResourceKey(item.resource)}
            item={item}
            index={index}
            pending={pendingKey === managedResourceKey(item.resource)}
            onInstall={onInstall}
          />
        ))}
      </div>

      {optional.length > 0
        ? (
            <div>
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {t('setup.runtimes.optional')}
                </span>
                <span className="text-[11px] text-muted-foreground/60">
                  {t('setup.runtimes.optionalHint')}
                </span>
              </div>
              <div className="divide-y divide-border/40">
                {optional.map((item, index) => (
                  <OptionalRuntimeRow
                    key={managedResourceKey(item.resource)}
                    item={item}
                    index={index}
                    pending={pendingKey === managedResourceKey(item.resource)}
                    onInstall={onInstall}
                  />
                ))}
              </div>
            </div>
          )
        : null}

      <p className="px-1 text-[11px] leading-relaxed text-pretty text-muted-foreground/70">
        {t('setup.runtimes.backgroundNote')}
      </p>
    </div>
  )
}
