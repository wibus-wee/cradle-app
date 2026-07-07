import {
  ArrowRightCircleLine as ArrowRightIcon,
  CoinLine as CoinsIcon,
  Dashboard2Line as GaugeIcon,
  MailLine as MailIcon,
  Refresh1Line as RefreshCwIcon,
  Stopwatch2Line as TimerResetIcon,
  TimeLine as ClockIcon,
  WarningLine as AlertTriangleIcon,
} from '@mingcute/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Cell, XAxis } from 'recharts'

import {
  getProviderTargetsByProviderTargetIdCodexAccountDiagnosticsOptions,
  getProviderTargetsByProviderTargetIdCodexWhamDiagnosticsOptions,
  postProviderTargetsByProviderTargetIdCodexRateLimitResetCreditConsumeMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetProviderTargetsByProviderTargetIdCodexAccountDiagnosticsResponse,
} from '~/api-gen/types.gen'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import type { ChartConfig } from '~/components/ui/chart'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '~/components/ui/chart'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '~/components/ui/dialog'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Separator } from '~/components/ui/separator'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'
import { clampPercent } from '~/lib/number-format'

type CodexAccountDiagnostics = GetProviderTargetsByProviderTargetIdCodexAccountDiagnosticsResponse
type RateLimitSnapshot = NonNullable<CodexAccountDiagnostics['rateLimits']>
type RateLimitWindow = NonNullable<RateLimitSnapshot['primary']>
type DailyBucket = NonNullable<CodexAccountDiagnostics['tokenUsage']>['dailyUsageBuckets'][number]

type StatusKind = 'idle' | 'available' | 'limited' | 'unsupported' | 'error'
type AgentManagementKey = keyof typeof import('~/locales/default').default.agentManagement

const DAILY_TOKENS_CHART_CONFIG: ChartConfig = {
  tokens: { label: 'Tokens' },
}

export function CodexAccountDiagnosticsPanel({ providerTargetId }: { providerTargetId: string }) {
  const { t } = useTranslation('agentManagement')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetAttemptKey, setResetAttemptKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>('account')

  const diagnosticsQuery = useQuery({
    ...getProviderTargetsByProviderTargetIdCodexAccountDiagnosticsOptions({
      path: { providerTargetId },
    }),
    enabled: false,
  })

  const whamQuery = useQuery({
    ...getProviderTargetsByProviderTargetIdCodexWhamDiagnosticsOptions({
      path: { providerTargetId },
    }),
    enabled: false,
  })

  const resetCredit = useMutation({
    ...postProviderTargetsByProviderTargetIdCodexRateLimitResetCreditConsumeMutation(),
    onSuccess: (result) => {
      setResetAttemptKey(null)
      toastManager.add({
        type: result.outcome === 'reset' ? 'success' : 'info',
        title: formatResetOutcome(result.outcome),
      })
      void diagnosticsQuery.refetch()
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: 'Reset failed',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    },
  })

  const diagnostics = diagnosticsQuery.data ?? null
  const canUseResetCredit = isResetCreditAvailable(diagnostics)
  const resetCreditCount = readResetCreditCount(diagnostics)
  const whamDiagnostics = whamQuery.data ?? null
  const whamResetCreditResult = whamDiagnostics?.supported
    ? whamDiagnostics.endpoints.rateLimitResetCredits
    : null
  // The WHAM reset-credits probe is the authoritative, direct-from-ChatGPT
  // source (count + per-credit expiry). Fall back to the account-diagnostics
  // count when the probe hasn't loaded or failed.
  const whamResetCredits = whamResetCreditResult?.ok
    ? readWhamResetCredits(whamResetCreditResult.body)
    : null
  const statusKind = deriveStatusKind(diagnostics, diagnosticsQuery.error)
  const loadingLabel = t('codexDiagnostics.loading' as AgentManagementKey)

  // Open the dialog → fetch once if we have nothing yet.
  useEffect(() => {
    if (!dialogOpen) {
      return
    }
    if (diagnosticsQuery.data === undefined && !diagnosticsQuery.isFetching && !diagnosticsQuery.error) {
      void diagnosticsQuery.refetch()
    }
  }, [dialogOpen, diagnosticsQuery])

  // Lazy-fetch WHAM diagnostics the first time the Rate limits tab is opened —
  // the reset-credits card reads from the WHAM probe.
  useEffect(() => {
    if (!dialogOpen || activeTab !== 'rate-limits') {
      return
    }
    if (whamQuery.data === undefined && !whamQuery.isFetching && !whamQuery.error) {
      void whamQuery.refetch()
    }
  }, [dialogOpen, activeTab, whamQuery])

  const refresh = () => {
    void diagnosticsQuery.refetch()
    // Only hit the WHAM endpoints if the Rate limits tab is active or WHAM has
    // been loaded before — avoid probing ChatGPT on every generic refresh.
    if (activeTab === 'rate-limits' || whamQuery.data !== undefined) {
      void whamQuery.refetch()
    }
  }

  const openResetDialog = () => {
    setResetAttemptKey(current => current ?? crypto.randomUUID())
    setResetDialogOpen(true)
  }

  const consumeResetCredit = () => {
    const idempotencyKey = resetAttemptKey ?? crypto.randomUUID()
    setResetAttemptKey(idempotencyKey)
    resetCredit.mutate({
      path: { providerTargetId },
      body: { idempotencyKey },
    })
    setResetDialogOpen(false)
  }

  return (
    <>
      <SummaryCard
        diagnostics={diagnostics}
        statusKind={statusKind}
        loading={diagnosticsQuery.isFetching}
        error={diagnosticsQuery.error}
        resetCreditCount={resetCreditCount}
        onRefresh={refresh}
        onOpen={() => setDialogOpen(true)}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className="flex max-h-[calc(100vh-2rem)]  w-180 max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
          showCloseButton
        >
          <DialogHeaderBar
            diagnostics={diagnostics}
            loading={diagnosticsQuery.isFetching || whamQuery.isFetching}
            error={diagnosticsQuery.error}
            onRefresh={refresh}
            canUseResetCredit={canUseResetCredit}
            resetCreditCount={resetCreditCount}
            onUseResetCredit={openResetDialog}
            resetPending={resetCredit.isPending}
          />

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col gap-0">
            <div className="flex items-center justify-between gap-2 px-6 pt-1">
              <TabsList variant="line" className="h-9">
                <TabsTrigger value="account" className="gap-1.5 px-2.5">
                  <MailIcon className="!size-3.5 !text-muted-foreground" />
                  Account
                </TabsTrigger>
                <TabsTrigger value="rate-limits" className="gap-1.5 px-2.5">
                  <GaugeIcon className="!size-3.5 !text-muted-foreground" />
                  Rate limits
                </TabsTrigger>
                <TabsTrigger value="usage" className="gap-1.5 px-2.5">
                  <ClockIcon className="!size-3.5 !text-muted-foreground" />
                  Usage
                </TabsTrigger>
              </TabsList>
            </div>

            <Separator className="bg-foreground/6" />

            <TabsContent value="account" className="mt-0 min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <AccountTab diagnostics={diagnostics} loading={diagnosticsQuery.isFetching} error={diagnosticsQuery.error} loadingLabel={loadingLabel} />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="rate-limits" className="mt-0 min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <RateLimitsTab
                  diagnostics={diagnostics}
                  loading={diagnosticsQuery.isFetching}
                  error={diagnosticsQuery.error}
                  loadingLabel={loadingLabel}
                  resetCreditCount={resetCreditCount}
                  whamResetCredits={whamResetCredits}
                  whamLoading={whamQuery.isFetching}
                  onUseResetCredit={openResetDialog}
                  resetPending={resetCredit.isPending}
                />
              </ScrollArea>
            </TabsContent>

            <TabsContent value="usage" className="mt-0 min-h-0 flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <UsageTab diagnostics={diagnostics} loading={diagnosticsQuery.isFetching} error={diagnosticsQuery.error} loadingLabel={loadingLabel} />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <TimerResetIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>Use reset credit?</AlertDialogTitle>
            <AlertDialogDescription>
              {resetCreditCount !== null
                ? `This consumes one ChatGPT account reset credit to reset the active rate-limit window. You currently have ${resetCreditCount} ${resetCreditCount === 1 ? 'credit' : 'credits'} available.`
                : 'This consumes one ChatGPT account reset credit to reset the active rate-limit window for this Codex provider target.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="sm" onClick={() => setResetAttemptKey(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction size="sm" onClick={consumeResetCredit}>
              Use credit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SummaryCard({
  diagnostics,
  statusKind,
  loading,
  error,
  resetCreditCount,
  onRefresh,
  onOpen,
}: {
  diagnostics: CodexAccountDiagnostics | null
  statusKind: StatusKind
  loading: boolean
  error: Error | null
  resetCreditCount: number | null
  onRefresh: () => void
  onOpen: () => void
}) {
  const plan = diagnostics?.account?.planType
  const statusLabel = formatStatusLabel(statusKind, loading, diagnostics, error)
  const accountHint = diagnostics?.account?.email
    ?? (diagnostics?.supported === false ? diagnostics.unavailableReason : null)
    ?? 'Not refreshed'
  const showCredits = resetCreditCount !== null
  const hasCredits = (resetCreditCount ?? 0) > 0

  return (
    <section className="group/card mt-1 flex items-center justify-between gap-3 rounded-xl border border-foreground/8 bg-muted/20 px-3 py-2.5 transition-colors hover:border-foreground/12 hover:bg-muted/30">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <StatusDot status={statusKind} loading={loading} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
            <GaugeIcon className="!size-3.5 !text-muted-foreground" />
            <span>Account diagnostics</span>
            {plan && (
              <Badge variant="secondary" className="ml-0.5 h-[18px] px-1.5 text-[10px] font-medium">
                {plan}
              </Badge>
            )}
            {showCredits && (
              <span
                title={`${resetCreditCount} reset credit${hasCredits && resetCreditCount === 1 ? '' : 's'} available`}
                className={cn(
                  'inline-flex h-[18px] items-center gap-0.5 rounded-full px-1.5 text-[10px] font-medium tabular-nums',
                  hasCredits
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-foreground/[0.04] text-muted-foreground',
                )}
              >
                <TimerResetIcon className="!size-3" />
                {resetCreditCount}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            <span className="text-foreground/70">{statusLabel}</span>
            <span className="mx-1.5 text-foreground/15">·</span>
            <span className="truncate">{accountHint}</span>
          </p>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh diagnostics"
        >
          {loading ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="!size-3.5" />}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onOpen}
          className="gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          Details
          <ArrowRightIcon className="!size-3.5" />
        </Button>
      </div>
    </section>
  )
}

function DialogHeaderBar({
  diagnostics,
  loading,
  error,
  onRefresh,
  canUseResetCredit,
  resetCreditCount,
  onUseResetCredit,
  resetPending,
}: {
  diagnostics: CodexAccountDiagnostics | null
  loading: boolean
  error: Error | null
  onRefresh: () => void
  canUseResetCredit: boolean
  resetCreditCount: number | null
  onUseResetCredit: () => void
  resetPending: boolean
}) {
  const plan = diagnostics?.account?.planType ?? null
  const email = diagnostics?.account?.email ?? null
  const refreshedAt = diagnostics?.refreshedAt ?? null
  const metaLine = buildHeaderMetaLine({ email, refreshedAt, loading, error })

  return (
    <div className="flex shrink-0 items-start justify-between gap-3 px-6 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <DialogTitle className="text-[15px] font-medium tracking-tight">
            Account diagnostics
          </DialogTitle>
          {plan && (
            <Badge variant="secondary" className="h-[18px] px-1.5 text-[10px] font-medium">
              {plan}
            </Badge>
          )}
        </div>
        <DialogDescription className="mt-1 truncate text-[11.5px] text-muted-foreground">
          {metaLine}
        </DialogDescription>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {canUseResetCredit && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onUseResetCredit}
            disabled={resetPending}
            className="gap-1.5"
          >
            {resetPending ? <Spinner className="size-3.5" /> : <TimerResetIcon className="!size-3.5" />}
            Use credit
            <ResetCreditCountBadge count={resetCreditCount} />
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRefresh}
          disabled={loading}
          className="gap-1.5"
        >
          {loading ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="!size-3.5" />}
          Refresh
        </Button>
      </div>
    </div>
  )
}

function ResetCreditCountBadge({ count }: { count: number | null }) {
  return (
    <span className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-foreground/8 px-1 text-[10px] font-semibold tabular-nums text-foreground/80">
      {count ?? '—'}
    </span>
  )
}

function AccountTab({
  diagnostics,
  loading,
  error,
  loadingLabel,
}: {
  diagnostics: CodexAccountDiagnostics | null
  loading: boolean
  error: Error | null
  loadingLabel: string
}) {
  const body = renderNoticeBody(diagnostics, loading, error, loadingLabel)
  if (body) {
    return <div className="px-6 py-8">{body}</div>
  }

  const account = diagnostics?.account
  const rows: Array<[string, ReactNode]> = [
    ['Email', renderMono(account?.email ?? null)],
    ['Account type', formatAccountType(account?.accountType ?? null)],
    ['Auth mode', renderMono(account?.authMode ?? null)],
    ['OpenAI auth', formatAuthRequired(account?.requiresOpenaiAuth ?? null)],
    ['Plan', renderMono(account?.planType ?? null)],
  ]

  return (
    <div className={cn('px-6 py-6', loading && 'opacity-70')}>
      <div className="mx-auto max-w-xl">
        <SectionLabel icon={<MailIcon className="!size-3.5" />}>Account</SectionLabel>
        <dl className="mt-3 divide-y divide-foreground/5 overflow-hidden rounded-xl ring-1 ring-foreground/6">
          {rows.map(([label, value]) => (
            <Row key={label} label={label} value={value} />
          ))}
        </dl>
      </div>
    </div>
  )
}

function RateLimitsTab({
  diagnostics,
  loading,
  error,
  loadingLabel,
  resetCreditCount,
  whamResetCredits,
  whamLoading,
  onUseResetCredit,
  resetPending,
}: {
  diagnostics: CodexAccountDiagnostics | null
  loading: boolean
  error: Error | null
  loadingLabel: string
  resetCreditCount: number | null
  whamResetCredits: WhamResetCredits | null
  whamLoading: boolean
  onUseResetCredit: () => void
  resetPending: boolean
}) {
  const body = renderNoticeBody(diagnostics, loading, error, loadingLabel)
  if (body) {
    return <div className="px-6 py-8">{body}</div>
  }

  // The single-bucket `rateLimits` is a backward-compatible mirror of the
  // primary limit; the multi-bucket `rateLimitsByLimitId` is the source of
  // truth. Rendering both duplicates the same limit, so prefer the multi-bucket
  // view when present and only fall back to the single bucket otherwise.
  const defaultSnapshot = diagnostics?.rateLimits ?? null
  const byLimitId = diagnostics?.rateLimitsByLimitId ?? null
  const entries = byLimitId ? Object.entries(byLimitId) : []

  const cards: Array<{ key: string, snapshot: RateLimitSnapshot, highlighted: boolean }> = []
  if (entries.length > 0) {
    const primaryLimitId = defaultSnapshot?.limitId ?? null
    const highlightedKey = (primaryLimitId && byLimitId![primaryLimitId]) ? primaryLimitId : entries[0][0]
    for (const [limitId, snapshot] of entries) {
      cards.push({ key: limitId, snapshot, highlighted: limitId === highlightedKey })
    }
  }
  else if (defaultSnapshot) {
    cards.push({ key: defaultSnapshot.limitId ?? 'default', snapshot: defaultSnapshot, highlighted: true })
  }

  const totalBuckets = cards.length
  const limitedCount = cards.filter(c => Boolean(c.snapshot.rateLimitReachedType)).length

  return (
    <div className={cn('px-6 py-6', loading && 'opacity-70')}>
      <div className="mx-auto max-w-2xl space-y-6">
        {(resetCreditCount !== null || whamResetCredits !== null) && (
          <ResetCreditsCard
            whamCredits={whamResetCredits}
            fallbackCount={resetCreditCount}
            loading={whamLoading}
            onUse={onUseResetCredit}
            pending={resetPending}
          />
        )}

        <div className="flex items-center justify-between">
          <SectionLabel icon={<GaugeIcon className="!size-3.5" />}>Rate limit buckets</SectionLabel>
          <span className="text-[11px] text-muted-foreground">
            {buildBucketSummary(totalBuckets, limitedCount)}
          </span>
        </div>

        {totalBuckets > 0 && (
          <div className="grid gap-2.5">
            {cards.map(({ key, snapshot, highlighted }) => (
              <RateLimitCard key={key} rateLimits={snapshot} highlighted={highlighted} />
            ))}
          </div>
        )}

        {totalBuckets === 0 && (
          <div className="rounded-xl px-2 py-10 text-center text-[12px] text-muted-foreground">
            No rate limit data yet.
          </div>
        )}
      </div>
    </div>
  )
}

function ResetCreditsCard({
  whamCredits,
  fallbackCount,
  loading,
  onUse,
  pending,
}: {
  whamCredits: WhamResetCredits | null
  fallbackCount: number | null
  loading: boolean
  onUse: () => void
  pending: boolean
}) {
  const count = whamCredits?.availableCredits ?? fallbackCount ?? 0
  const hasCredits = count > 0
  const refreshingWham = loading && whamCredits === null
  const credits = whamCredits?.credits ?? []

  return (
    <div className="rounded-xl bg-muted/20 px-4 py-3 ring-1 ring-foreground/6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-md',
              hasCredits ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-foreground/[0.05] text-muted-foreground',
            )}
          >
            <TimerResetIcon className="!size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
              Reset credits
              {refreshingWham && <Spinner className="size-3" />}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              Instantly reset the active rate-limit window.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <div className="font-mono text-[15px] font-medium leading-none tabular-nums text-foreground">
              {count}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {hasCredits ? 'available' : 'none left'}
            </div>
          </div>
          {hasCredits && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onUse}
              disabled={pending}
              className="gap-1.5"
            >
              {pending ? <Spinner className="size-3.5" /> : <TimerResetIcon className="!size-3.5" />}
              Use credit
            </Button>
          )}
        </div>
      </div>

      {credits.length > 0 && (
        <div className="mt-3 grid gap-1.5">
          {credits.map((credit, index) => (
            <WhamResetCreditRow key={credit.id ?? index} credit={credit} index={index} />
          ))}
        </div>
      )}
    </div>
  )
}

function UsageTab({
  diagnostics,
  loading,
  error,
  loadingLabel,
}: {
  diagnostics: CodexAccountDiagnostics | null
  loading: boolean
  error: Error | null
  loadingLabel: string
}) {
  const body = renderNoticeBody(diagnostics, loading, error, loadingLabel)
  if (body) {
    return <div className="px-6 py-8">{body}</div>
  }

  const usage = diagnostics?.tokenUsage
  if (!usage) {
    return (
      <div className="px-6 py-10 text-center text-[12px] text-muted-foreground">
        No usage data.
      </div>
    )
  }

  const buckets = usage.dailyUsageBuckets
  const peak = usage.summary.peakDailyTokens

  const summaryStats: Array<[string, ReactNode]> = [
    ['Lifetime tokens', formatCounter(usage.summary.lifetimeTokens)],
    ['Peak daily', formatCounter(usage.summary.peakDailyTokens)],
    ['Longest turn', formatSeconds(usage.summary.longestRunningTurnSec)],
    ['Current streak', formatDays(usage.summary.currentStreakDays)],
    ['Longest streak', formatDays(usage.summary.longestStreakDays)],
    ['Days tracked', formatCounter(String(buckets.length))],
  ]

  return (
    <div className={cn('px-6 py-6', loading && 'opacity-70')}>
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <SectionLabel icon={<ClockIcon className="!size-3.5" />}>Summary</SectionLabel>
          <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl ring-1 ring-foreground/6 sm:grid-cols-3">
            {summaryStats.map(([label, value]) => (
              <div key={label} className="bg-muted/30 px-3.5 py-3">
                <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
                <div className="mt-1 font-mono text-[15px] font-medium tabular-nums text-foreground">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {buckets.length > 0 && (
          <DailyTokensChart buckets={buckets} peakValue={peak} />
        )}
      </div>
    </div>
  )
}

function WhamResetCreditRow({ credit, index }: { credit: WhamResetCredit, index: number }) {
  const relativeExpiry = formatRelativeExpiry(credit.expiresAt)
  const expired = relativeExpiry === 'expired'
  const daysUntilExpiry = daysUntil(credit.expiresAt)
  const expiringSoon = !expired && daysUntilExpiry !== null && daysUntilExpiry <= 7

  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2.5 ring-1 ring-foreground/5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 text-[10.5px] font-medium text-muted-foreground/70">
#
{index + 1}
          </span>
          <span className="truncate text-[12px] font-medium text-foreground">
            {credit.title ?? 'Rate-limit reset credit'}
          </span>
        </div>
        {credit.status && <WhamCreditStatusPill status={credit.status} />}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <ClockIcon className={cn('!size-3.5 shrink-0', expired ? '!text-destructive' : '!text-muted-foreground/60')} />
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/60">Expires</span>
        <span
          className={cn(
            'font-mono text-[12px] font-medium tabular-nums',
            expired ? 'text-destructive' : 'text-foreground',
          )}
        >
          {credit.expiresAt !== null ? formatWhamTimestamp(credit.expiresAt) : 'never'}
        </span>
        {relativeExpiry && (
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
              expired
                ? 'bg-destructive/10 text-destructive'
                : expiringSoon
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-foreground/[0.05] text-muted-foreground',
            )}
          >
            {relativeExpiry}
          </span>
        )}
      </div>

      <div className="mt-1 flex items-center gap-2 pl-[22px]">
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/50">Granted</span>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
          {formatWhamTimestamp(credit.grantedAt)}
        </span>
      </div>
    </div>
  )
}

function WhamCreditStatusPill({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  const isAvailable = normalized === 'available'
  return (
    <span
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium',
        isAvailable
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-foreground/[0.05] text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 rounded-full', isAvailable ? 'bg-emerald-500' : 'bg-foreground/30')} />
      {status}
    </span>
  )
}

interface WhamResetCredit {
  id: string | null
  title: string | null
  status: string | null
  grantedAt: number | null
  expiresAt: number | null
}

interface WhamResetCredits {
  availableCredits: number
  totalEarnedCount: number
  credits: WhamResetCredit[]
}

// WHAM timestamps arrive as ISO-8601 strings (e.g. "2026-07-18T00:36:52Z").
// Tolerate unix seconds / ms numbers and numeric strings too, just in case.
function parseWhamTimestamp(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? (raw < 1e12 ? raw * 1000 : raw) : null
  }
  if (typeof raw === 'string') {
    const asNumber = Number(raw)
    if (Number.isFinite(asNumber) && /^\d+(\.\d+)?$/.test(raw.trim())) {
      return asNumber < 1e12 ? asNumber * 1000 : asNumber
    }
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function readWhamResetCredits(body: unknown): WhamResetCredits | null {
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const root = body as Record<string, unknown>
  const availableRaw = root.available_count ?? root.available_credits
  if (typeof availableRaw !== 'number' && typeof availableRaw !== 'string') {
    return null
  }
  const availableCredits = typeof availableRaw === 'number' ? availableRaw : Number(availableRaw)
  if (!Number.isFinite(availableCredits)) {
    return null
  }
  const totalEarnedRaw = root.total_earned_count
  const totalEarnedCount = typeof totalEarnedRaw === 'number'
    ? totalEarnedRaw
    : typeof totalEarnedRaw === 'string' && Number.isFinite(Number(totalEarnedRaw))
      ? Number(totalEarnedRaw)
      : 0
  const credits: WhamResetCredit[] = []
  const creditsRaw = root.credits
  if (Array.isArray(creditsRaw)) {
    for (const entry of creditsRaw) {
      if (typeof entry !== 'object' || entry === null) {
        continue
      }
      const e = entry as Record<string, unknown>
      const str = (key: string): string | null => {
        const value = e[key]
        return typeof value === 'string' ? value : null
      }
      credits.push({
        id: str('id'),
        title: str('title'),
        status: str('status'),
        grantedAt: parseWhamTimestamp(e.granted_at),
        expiresAt: parseWhamTimestamp(e.expires_at),
      })
    }
  }
  return { availableCredits, totalEarnedCount, credits }
}

function formatWhamTimestamp(value: number | null): string {
  if (value === null) {
    return 'n/a'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

// Relative countdown to expiry, e.g. "in 21 days", "in 5h", "expired".
function formatRelativeExpiry(expiresAt: number | null): string | null {
  if (expiresAt === null) {
    return null
  }
  const deltaMs = expiresAt - Date.now()
  if (deltaMs <= 0) {
    return 'expired'
  }
  const days = Math.ceil(deltaMs / 86_400_000)
  if (days >= 1) {
    return `in ${days} day${days === 1 ? '' : 's'}`
  }
  const hours = Math.ceil(deltaMs / 3_600_000)
  if (hours >= 1) {
    return `in ${hours}h`
  }
  const mins = Math.ceil(deltaMs / 60_000)
  return `in ${mins}m`
}

// Whole days until expiry (null when no expiry, negative/0 when expired).
function daysUntil(expiresAt: number | null): number | null {
  if (expiresAt === null) {
    return null
  }
  return Math.ceil((expiresAt - Date.now()) / 86_400_000)
}

function DailyTokensChart({ buckets, peakValue }: { buckets: DailyBucket[], peakValue: string | null }) {
  const peakNumeric = peakValue !== null ? Number(peakValue) : null

  const chartData = useMemo(
    () => buckets.map((bucket) => {
      const value = Number(bucket.tokens)
      return {
        date: bucket.startDate,
        tokens: value,
        isPeak: peakNumeric !== null && value === peakNumeric && value > 0,
      }
    }),
    [buckets, peakNumeric],
  )

  const peakCount = chartData.filter(d => d.isPeak).length
  const avgValue = chartData.length > 0
    ? Math.round(chartData.reduce((sum, d) => sum + d.tokens, 0) / chartData.length)
    : 0

  return (
    <div>
      <div className="flex items-center justify-between">
        <SectionLabel icon={<CoinsIcon className="!size-3.5" />}>Daily tokens</SectionLabel>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <ChartLegend label="avg" value={formatCounter(String(avgValue))} swatchClassName="bg-foreground/25" />
          <ChartLegend label="peak" value={formatCounter(peakValue)} swatchClassName="bg-foreground/80" />
          <ChartLegend label="days" value={formatCounter(String(buckets.length))} />
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-foreground/6">
        <div className="border-b border-foreground/5 px-4 py-2.5">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground/70">Peak day</div>
              <div className="mt-0.5 font-mono text-[15px] font-medium tabular-nums text-foreground">
                {formatCounter(peakValue)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground/70">Average / day</div>
              <div className="mt-0.5 font-mono text-[15px] font-medium tabular-nums text-foreground">
                {formatCounter(String(avgValue))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-background/40 px-1 pt-2">
          <ChartContainer
            config={DAILY_TOKENS_CHART_CONFIG}
            className="aspect-[4/1] h-[220px] w-full"
          >
            <BarChart
              data={chartData}
              margin={{ top: 6, right: 12, left: 12, bottom: 0 }}
              barCategoryGap="12%"
            >
              <CartesianGrid
                vertical={false}
                stroke="currentColor"
                strokeOpacity={0.06}
                strokeDasharray="2 4"
              />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={28}
                tick={{ fontSize: 10, fill: 'currentColor', fillOpacity: 0.55 }}
                tickFormatter={formatAxisTick}
              />
              <ChartTooltip
                cursor={{ fill: 'currentColor', fillOpacity: 0.04 }}
                content={(
                  <ChartTooltipContent
                    hideLabel
                    formatter={(value, _name, item) => {
                      const payload = item?.payload as { date: string, isPeak: boolean } | undefined
                      const date = payload?.date ?? ''
                      const tokens = typeof value === 'number' ? value : Number(value ?? 0)
                      return (
                        <div className="flex w-full items-center justify-between gap-4">
                          <span className="text-muted-foreground">{date}</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {formatCounter(String(tokens))}
                            {payload?.isPeak && (
                              <span className="ml-1.5 text-[9.5px] uppercase tracking-wider text-muted-foreground/80">
                                peak
                              </span>
                            )}
                          </span>
                        </div>
                      )
                    }}
                  />
                )}
              />
              <Bar dataKey="tokens" radius={[3, 3, 0, 0]} maxBarSize={26}>
                {chartData.map(entry => (
                  <Cell
                    key={entry.date}
                    fill={entry.isPeak ? 'var(--foreground)' : 'color-mix(in oklch, var(--foreground) 32%, transparent)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>

        <div className="border-t border-foreground/5 px-4 py-2 text-[10.5px] text-muted-foreground/70">
          {buildChartFooter(chartData.length, peakCount)}
        </div>
      </div>
    </div>
  )
}

function ChartLegend({ label, value, swatchClassName }: { label: string, value: string, swatchClassName?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {swatchClassName && <span className={cn('size-1.5 rounded-[2px]', swatchClassName)} />}
      <span className="text-muted-foreground/70">{label}</span>
      <span className="font-mono tabular-nums text-foreground/80">{value}</span>
    </div>
  )
}

function RateLimitCard({ rateLimits, highlighted = false }: { rateLimits: RateLimitSnapshot, highlighted?: boolean }) {
  const windows = [
    rateLimits.primary ? { label: 'Primary', window: rateLimits.primary } : null,
    rateLimits.secondary ? { label: 'Secondary', window: rateLimits.secondary } : null,
  ].filter((row): row is { label: string, window: RateLimitWindow } => row !== null)

  const reached = Boolean(rateLimits.rateLimitReachedType)

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl ring-1 transition-colors',
        highlighted ? 'bg-muted/25 ring-foreground/8' : 'bg-background/60 ring-foreground/6',
        reached && 'ring-destructive/25',
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-foreground/5 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-foreground">
              {rateLimits.limitName ?? rateLimits.limitId ?? 'Rate limit'}
            </span>
            {rateLimits.planType && (
              <Badge variant="outline" className="h-[16px] px-1.5 text-[9.5px] font-medium text-muted-foreground">
                {rateLimits.planType}
              </Badge>
            )}
          </div>
          {rateLimits.limitId && rateLimits.limitId !== rateLimits.limitName && (
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground/70">
              {rateLimits.limitId}
            </div>
          )}
        </div>
        <StatusPill reached={reached} />
      </div>

      <div className="space-y-3 px-4 py-3">
        {windows.length > 0 && (
          <div className={cn('grid gap-3', windows.length > 1 && 'sm:grid-cols-2')}>
            {windows.map(({ label, window }) => (
              <RateLimitWindowPanel key={label} label={label} window={window} />
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/30 px-3 py-2.5">
          <Stat label="Balance" value={rateLimits.credits?.balance ?? 'n/a'} />
          <Stat label="Has credits" value={formatBoolean(rateLimits.credits?.hasCredits ?? null)} />
          <Stat label="Unlimited" value={formatBoolean(rateLimits.credits?.unlimited ?? null)} />
        </div>

        {rateLimits.individualLimit && (
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/30 px-3 py-2.5 sm:grid-cols-4">
            <Stat label="Individual limit" value={rateLimits.individualLimit.limit} mono />
            <Stat label="Used" value={rateLimits.individualLimit.used} mono />
            <Stat label="Remaining" value={formatRemainingPercent(rateLimits.individualLimit.remainingPercent)} mono />
            <Stat label="Resets in" value={formatResetLabel(rateLimits.individualLimit.resetsAt)} />
          </div>
        )}
      </div>
    </div>
  )
}

function RateLimitWindowPanel({ label, window }: { label: string, window: RateLimitWindow }) {
  const usedPercent = clampPercent(window.usedPercent)
  const remainingPercent = clampPercent(100 - usedPercent)

  return (
    <div className="rounded-lg bg-muted/25 px-3 py-2.5 ring-1 ring-foreground/5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/80">{label}</span>
        <span className="font-mono text-[12px] font-medium tabular-nums text-foreground">
          {Math.round(remainingPercent)}
          <span className="text-muted-foreground/60">%</span>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/8">
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            remainingPercent < 10
              ? 'bg-destructive'
              : remainingPercent < 30
                ? 'bg-foreground/70'
                : 'bg-foreground/45',
          )}
          style={{ width: `${remainingPercent}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground/80">
        <span>{formatWindowDuration(window.windowDurationMins)}</span>
        <span>{buildResetsInLabel(window.resetsAt)}</span>
      </div>
    </div>
  )
}

function StatusPill({ reached }: { reached: boolean }) {
  if (reached) {
    return (
      <Badge variant="destructive" className="h-[20px] gap-1 px-2 text-[10.5px] font-medium">
        <span className="size-1.5 rounded-full bg-destructive" />
        Limited
      </Badge>
    )
  }
  return (
    <span className="inline-flex h-[20px] shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
      <span className="size-1.5 rounded-full bg-emerald-500" />
      Available
    </span>
  )
}

function StatusDot({ status, loading }: { status: StatusKind, loading: boolean }) {
  const color = statusDotColor(status)
  return (
    <span className="relative inline-flex size-2 shrink-0">
      <span
        className={cn(
          'absolute inset-0 rounded-full',
          color,
          loading && 'animate-pulse',
        )}
      />
      {loading && (
        <span className={cn('absolute inset-0 rounded-full opacity-60', color, 'animate-ping')} />
      )}
    </span>
  )
}

function SectionLabel({ icon, children }: { icon: ReactNode, children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/70">
      <span className="text-muted-foreground/80">{icon}</span>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string, value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-background/40 px-3.5 py-2.5 text-[12px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate font-mono tabular-nums text-foreground">{value}</dd>
    </div>
  )
}

function Stat({ label, value, mono = true }: { label: string, value: string, mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</div>
      <div className={cn('mt-0.5 truncate text-[12px] text-foreground', mono && 'font-mono tabular-nums')}>
        {value}
      </div>
    </div>
  )
}

function renderNoticeBody(
  diagnostics: CodexAccountDiagnostics | null,
  loading: boolean,
  error: Error | null,
  loadingLabel: string,
): ReactNode | null {
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-destructive/6 px-3 py-2.5 text-[12px] text-destructive">
        <AlertTriangleIcon className="!size-3.5 shrink-0 !text-destructive" />
        <span className="min-w-0 break-words">{error.message}</span>
      </div>
    )
  }

  if (loading && !diagnostics) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-muted-foreground">
        <Spinner className="size-3.5" />
        {loadingLabel}
      </div>
    )
  }

  if (!diagnostics) {
    return (
      <div className="rounded-xl bg-muted/30 px-3 py-10 text-center text-[12px] text-muted-foreground">
        Not refreshed yet.
      </div>
    )
  }

  if (!diagnostics.supported) {
    return (
      <div className="rounded-xl bg-muted/30 px-3 py-10 text-center text-[12px] text-muted-foreground">
        {diagnostics.unavailableReason ?? 'Not supported for this account.'}
      </div>
    )
  }

  return null
}

function renderMono(value: string | null): ReactNode {
  if (!value) {
    return <span className="text-muted-foreground/50">n/a</span>
  }
  return value
}

function deriveStatusKind(
  diagnostics: CodexAccountDiagnostics | null,
  error: Error | null,
): StatusKind {
  if (error) {
    return 'error'
  }
  if (!diagnostics) {
    return 'idle'
  }
  if (!diagnostics.supported) {
    return 'unsupported'
  }
  if (diagnostics.rateLimits?.rateLimitReachedType) {
    return 'limited'
  }
  const byLimitId = Object.values(diagnostics.rateLimitsByLimitId ?? {})
  if (byLimitId.some(r => Boolean(r.rateLimitReachedType))) {
    return 'limited'
  }
  return 'available'
}

function statusDotColor(status: StatusKind): string {
  switch (status) {
    case 'available':
      return 'bg-emerald-500'
    case 'limited':
      return 'bg-destructive'
    case 'error':
      return 'bg-destructive'
    case 'unsupported':
      return 'bg-foreground/20'
    case 'idle':
    default:
      return 'bg-foreground/25'
  }
}

function formatStatusLabel(
  status: StatusKind,
  loading: boolean,
  diagnostics: CodexAccountDiagnostics | null,
  error: Error | null,
): string {
  if (loading && !diagnostics) {
    return 'Fetching'
  }
  if (loading) {
    return 'Refreshing'
  }
  if (error) {
    return 'Error'
  }
  if (!diagnostics) {
    return 'Idle'
  }
  if (!diagnostics.supported) {
    return 'Unsupported'
  }
  switch (status) {
    case 'limited':
      return 'Limited'
    case 'available':
      return 'Available'
    default:
      return 'Idle'
  }
}

function buildHeaderMetaLine({
  email,
  refreshedAt,
  loading,
  error,
}: {
  email: string | null
  refreshedAt: number | null
  loading: boolean
  error: Error | null
}): string {
  const parts: string[] = []
  if (email) {
    parts.push(email)
  }
  if (error) {
    parts.push('Refresh failed')
  }
  else if (loading && !refreshedAt) {
    parts.push('Fetching…')
  }
  else if (loading) {
    parts.push('Refreshing…')
  }
  else if (refreshedAt) {
    parts.push(`Updated ${formatUpdatedAt(refreshedAt)}`)
  }
  else {
    parts.push('Never refreshed')
  }
  return parts.join(' · ')
}

function buildBucketSummary(total: number, limited: number): string {
  if (total === 0) {
    return 'No buckets'
  }
  if (limited === 0) {
    return `${total} bucket${total > 1 ? 's' : ''} · all available`
  }
  return `${total} bucket${total > 1 ? 's' : ''} · ${limited} limited`
}

function buildResetsInLabel(resetsAt: number | null): string {
  if (resetsAt === null) {
    return 'reset n/a'
  }
  return `resets in ${formatResetLabel(resetsAt)}`
}

function buildChartFooter(totalDays: number, peakCount: number): string {
  if (peakCount === 0) {
    return `${totalDays} day${totalDays > 1 ? 's' : ''} of activity`
  }
  return `${totalDays} day${totalDays > 1 ? 's' : ''} · ${peakCount} peak day${peakCount > 1 ? 's' : ''}`
}

function formatAxisTick(value: string): string {
  // YYYY-MM-DD → MM/DD
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    return value
  }
  return `${match[2]}/${match[3]}`
}

function isResetCreditAvailable(diagnostics: CodexAccountDiagnostics | null): boolean {
  return diagnostics?.supported === true
    && (readResetCreditCount(diagnostics) ?? 0) > 0
}

function readResetCreditCount(diagnostics: CodexAccountDiagnostics | null): number | null {
  const raw = diagnostics?.rateLimitResetCredits?.availableCount
  if (raw === undefined || raw === null) {
    return null
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function formatAccountType(value: string | null): string {
  switch (value) {
    case 'chatgpt':
      return 'ChatGPT'
    case 'apiKey':
      return 'API key'
    case 'amazonBedrock':
      return 'Amazon Bedrock'
    case null:
      return 'n/a'
    default:
      return value
  }
}

function formatAuthRequired(value: boolean | null): string {
  if (value === null) {
    return 'n/a'
  }
  return value ? 'required' : 'ok'
}

function formatBoolean(value: boolean | null): string {
  if (value === null) {
    return 'n/a'
  }
  return value ? 'yes' : 'no'
}

function formatRemainingPercent(value: number): string {
  return `${Math.round(clampPercent(value))}%`
}

function formatUpdatedAt(value: number): string {
  const date = new Date(value)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function formatCounter(value: string | null): string {
  if (!value) {
    return 'n/a'
  }
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatDays(value: string | null): string {
  return value ? `${formatCounter(value)}d` : 'n/a'
}

function formatSeconds(value: string | null): string {
  if (!value) {
    return 'n/a'
  }
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) {
    return `${formatCounter(value)}s`
  }
  if (seconds < 60) {
    return `${seconds}s`
  }
  if (seconds < 3_600) {
    return `${Math.round(seconds / 60)}m`
  }
  return `${Math.round(seconds / 3_600)}h`
}

function formatWindowDuration(durationMins: number | null): string {
  if (durationMins === null || durationMins <= 0) {
    return 'window n/a'
  }
  if (durationMins === 10_080) {
    return 'weekly window'
  }
  if (durationMins === 43_200 || durationMins === 43_800 || durationMins === 44_640) {
    return 'monthly window'
  }
  if (durationMins % 1_440 === 0) {
    return `${durationMins / 1_440}d window`
  }
  if (durationMins % 60 === 0) {
    return `${durationMins / 60}h window`
  }
  return `${durationMins}m window`
}

function formatResetLabel(resetsAt: number | null): string {
  if (resetsAt === null) {
    return 'n/a'
  }
  const deltaSeconds = resetsAt - Math.floor(Date.now() / 1_000)
  if (deltaSeconds <= 0) {
    return 'now'
  }
  if (deltaSeconds < 3_600) {
    return `${Math.ceil(deltaSeconds / 60)}m`
  }
  if (deltaSeconds < 86_400) {
    return `${Math.ceil(deltaSeconds / 3_600)}h`
  }
  return `${Math.ceil(deltaSeconds / 86_400)}d`
}

function formatResetOutcome(outcome: 'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed'): string {
  switch (outcome) {
    case 'reset':
      return 'Limit reset'
    case 'nothingToReset':
      return 'Nothing to reset'
    case 'noCredit':
      return 'No reset credit'
    case 'alreadyRedeemed':
      return 'Already redeemed'
  }
}
