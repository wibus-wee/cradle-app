import {
  CheckCircleLine as CheckCircleIcon,
  ExternalLinkLine as ExternalLinkIcon,
  EyeLine as ReviewIcon,
  GitBranchLine as GitBranchIcon,
  GitCommitLine as GitCommitIcon,
  GitCompareLine as FileDiffIcon,
  GitPullRequestLine as PullRequestIcon,
  Message1Line as CommentIcon,
  Refresh1Line as RefreshIcon,
  User2Line as UserAssignIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { m } from 'motion/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Skeleton } from '~/components/ui/skeleton'
import { AssetMarkdown } from '~/features/assets/asset-markdown'
import { cn } from '~/lib/cn'
import { openWork } from '~/navigation/navigation-commands'

import type { PullRequestDetail } from './api/pull-requests'
import { pullRequestQueryOptions } from './api/pull-requests'
import type { StatusIconType } from './status-meta'
import { STATUS_ICON, STATUS_ICON_CLASS, statusKind } from './status-meta'

// Notion-style inner page: a centered narrow column, a confident title,
// a calm meta row, page-property rows, and pill tabs - the same document
// idiom as workspace-detail-page. Hierarchy comes from type scale + space,
// not boxes or colored pills.

type TimelineItem = PullRequestDetail['timeline'][number]
type PullRequestFile = PullRequestDetail['files'][number]
type Tab = 'summary' | 'timeline' | 'code'

function formatTimestamp(timestamp: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

function formatRelativeFromIso(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 60) {
    return `${Math.max(minutes, 0)}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h`
  }
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function PullRequestDetailPanel({
  owner,
  repo,
  number,
  workId,
}: {
  owner: string
  repo: string
  number: number
  // Only present when Cradle created/bound this PR through a Work session -
  // an optional overlay that unlocks the "Open Work" action, not a
  // precondition for reading the PR (see pull-request module README).
  workId?: string
}) {
  const { t, i18n } = useTranslation('pull-requests')
  const [activeTab, setActiveTab] = useState<Tab>('summary')
  const detailQuery = useQuery({
    ...pullRequestQueryOptions.detail({ path: { owner, repo, number: String(number) } }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  if (detailQuery.error) {
    throw detailQuery.error
  }

  const detail = detailQuery.data
  if (!detail) {
    return <PullRequestDetailSkeleton />
  }

  const pullRequest = detail.pullRequest
  const status = statusKind(pullRequest)
  const StatusIcon = STATUS_ICON[status]
  const tabs: Array<{ id: Tab, label: string }> = [
    { id: 'summary', label: t('detail.tab.summary') },
    { id: 'timeline', label: t('detail.tab.timeline') },
    { id: 'code', label: t('detail.tab.code') },
  ]

  return (
    <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background" data-testid="pull-request-detail-panel">
      {/* Minimal top chrome - just actions. The page identity lives in the
          document body below, Notion-style, not in a header band. */}
      <div className="flex shrink-0 items-center justify-end gap-1 px-4 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void detailQuery.refetch()}
          aria-label={t('detail.refresh')}
        >
          <RefreshIcon className={cn('size-3.5', detailQuery.isFetching && 'animate-spin')} />
        </Button>
        {workId && (
          <Button type="button" variant="outline" size="sm" onClick={() => openWork(workId)}>
            {t('detail.openWork')}
          </Button>
        )}
        <Button variant="outline" size="icon-sm" asChild aria-label={t('detail.openGithub')}>
          <a href={pullRequest.url} target="_blank" rel="noreferrer">
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pb-20">
          {/* Breadcrumb-style identity line */}
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className={cn('shrink-0', STATUS_ICON_CLASS[status])}>
              <StatusIcon className="size-3.5" aria-hidden="true" />
            </span>
            <span className="truncate font-mono">
              {pullRequest.owner}
              /
              {pullRequest.repo}
              {' #'}
              {pullRequest.number}
            </span>
            <span className="shrink-0 font-medium text-foreground/70">
              {t(`status.${status}`)}
            </span>
          </div>

          {/* Page title - confident, the anchor of the page */}
          <h1 className="mt-2 text-balance text-2xl font-semibold leading-tight tracking-tight text-foreground">
            {pullRequest.title}
          </h1>

          {/* Meta row - author, branches, recency. Calm, small, icon-led. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
            {pullRequest.author && (
              <span className="flex items-center gap-1.5">
                <img
                  src={pullRequest.author.avatarUrl}
                  alt=""
                  className="size-4 rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                />
                <span className="text-foreground/80">{pullRequest.author.login}</span>
              </span>
            )}
            <span className="flex min-w-0 items-center gap-1.5 font-mono">
              <GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{pullRequest.headRef}</span>
              <span aria-hidden="true">{'->'}</span>
              <span className="truncate">{pullRequest.baseRef}</span>
            </span>
            <span className="font-mono tabular-nums">
              {t('detail.updated', { ago: formatRelativeFromIso(pullRequest.updatedAtIso) })}
            </span>
          </div>

          {pullRequest.labels.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {pullRequest.labels.map(label => (
                <span
                  key={label.name}
                  className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[10.5px] text-foreground/70"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: `#${label.color}` }}
                    aria-hidden="true"
                  />
                  {label.name}
                </span>
              ))}
            </div>
          )}

          {/* Pill tabs - same idiom as workspace-detail-page (animated
              bg-accent pill via layoutId), not underline tabs. */}
          <div className="mt-6 flex items-center gap-0.5">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative z-10 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors select-none',
                  activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {activeTab === tab.id && (
                  <m.span
                    layoutId={`pr-detail-tab-${owner}/${repo}#${number}`}
                    className="absolute inset-0 rounded-md bg-accent"
                    transition={{ type: 'spring', stiffness: 600, damping: 40 }}
                    style={{ zIndex: -1 }}
                  />
                )}
                <span className="relative">{tab.label}</span>
              </button>
            ))}
          </div>

          <div className={activeTab === 'summary' ? undefined : 'hidden'}>
            <SummaryTab detail={detail} />
          </div>
          <div className={activeTab === 'timeline' ? undefined : 'hidden'}>
            <TimelineTab detail={detail} locale={i18n.language} />
          </div>
          <div className={activeTab === 'code' ? undefined : 'hidden'}>
            <CodeTab files={detail.files} />
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryTab({ detail }: { detail: PullRequestDetail }) {
  const { t } = useTranslation('pull-requests')
  const pullRequest = detail.pullRequest

  return (
    <div className="space-y-8 pt-6">
      {/* Page properties - clean label/value rows, Notion page-property style. */}
      <dl>
        <PropRow icon={GitCommitIcon} label={t('summary.commits')}>
          <span className="tabular-nums">{pullRequest.commits}</span>
        </PropRow>
        <PropRow icon={CommentIcon} label={t('summary.comments')}>
          <span className="tabular-nums">{pullRequest.comments + pullRequest.reviewComments}</span>
        </PropRow>
        <PropRow icon={FileDiffIcon} label={t('summary.changedFiles')}>
          <span className="tabular-nums">{pullRequest.changedFiles}</span>
          <span className="ml-2 font-mono text-[11px] text-success">
            +
            {pullRequest.additions}
          </span>
          <span className="font-mono text-[11px] text-destructive">
            −
            {pullRequest.deletions}
          </span>
        </PropRow>
        <PropRow icon={CheckCircleIcon} label={t('summary.checks')}>
          <ChecksValue state={pullRequest.checksState} count={pullRequest.checks.length} />
        </PropRow>
        <PropRow icon={UserAssignIcon} label={t('summary.assignees')}>
          <PeopleValue people={pullRequest.assignees} empty={t('summary.noAssignees')} />
        </PropRow>
        <PropRow icon={ReviewIcon} label={t('summary.reviewers')}>
          <PeopleValue people={pullRequest.reviewers} empty={t('summary.noReviewers')} />
        </PropRow>
      </dl>

      <section>
        <SectionHeading>{t('summary.description')}</SectionHeading>
        {pullRequest.body
          ? <AssetMarkdown content={pullRequest.body} className="text-pretty text-[14px] leading-7 text-foreground/85" />
          : <p className="text-[13px] italic text-muted-foreground/70">{t('summary.noDescription')}</p>}
      </section>

      {pullRequest.checks.length > 0 && (
        <section>
          <SectionHeading>{t('summary.checks')}</SectionHeading>
          <div className="divide-y divide-border/40">
            {pullRequest.checks.map(check => (
              <a
                key={check.id}
                href={check.url ?? undefined}
                target={check.url ? '_blank' : undefined}
                rel={check.url ? 'noreferrer' : undefined}
                className={cn(
                  'flex min-h-9 items-center justify-between gap-3 py-2 text-[12.5px] transition-colors',
                  check.url && 'hover:text-foreground',
                )}
              >
                <span className="truncate text-foreground/80">{check.name}</span>
                <CheckBadge status={check.status} conclusion={check.conclusion} />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function TimelineTab({ detail, locale }: { detail: PullRequestDetail, locale: string }) {
  const { t } = useTranslation('pull-requests')
  const events = useMemo(() => {
    const pullRequest = detail.pullRequest
    const lifecycle: Array<{
      id: string
      kind: 'lifecycle'
      label: string
      createdAt: string
    }> = [{
      id: 'created',
      kind: 'lifecycle',
      label: t('timeline.created'),
      createdAt: pullRequest.createdAtIso,
    }]
    if (pullRequest.mergedAtIso) {
      lifecycle.push({ id: 'merged', kind: 'lifecycle', label: t('timeline.merged'), createdAt: pullRequest.mergedAtIso })
    }
    else if (pullRequest.closedAtIso) {
      lifecycle.push({ id: 'closed', kind: 'lifecycle', label: t('timeline.closed'), createdAt: pullRequest.closedAtIso })
    }
    return [...lifecycle, ...detail.timeline].toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
  }, [detail, t])

  return (
    <div className="pt-6">
      {events.length > 0
        ? (
            <ol className="ml-2.5 border-l border-border/70">
              {events.map(event => event.kind === 'lifecycle'
                ? (
                    <li key={event.id} className="relative pb-5 pl-5 last:pb-0">
                      <span className="absolute -left-[11px] top-0 grid size-[22px] place-items-center rounded-full bg-background text-muted-foreground shadow-[var(--shadow-inset-ring)]">
                        <PullRequestIcon className="size-2.5" aria-hidden="true" />
                      </span>
                      <p className="text-[12.5px] font-medium text-foreground/85">{event.label}</p>
                      <time className="mt-0.5 block font-mono text-[10px] tabular-nums text-muted-foreground">
                        {formatTimestamp(event.createdAt, locale)}
                      </time>
                    </li>
                  )
                : <TimelineEntry key={event.id} item={event} locale={locale} />)}
            </ol>
          )
        : <p className="text-[13px] text-muted-foreground/70">{t('timeline.empty')}</p>}
    </div>
  )
}

function TimelineEntry({ item, locale }: { item: TimelineItem, locale: string }) {
  const { t } = useTranslation('pull-requests')
  const label = item.kind === 'comment'
    ? t('timeline.commented')
    : reviewLabel(item.state, t)

  return (
    <li className="relative pb-5 pl-5 last:pb-0">
      <span className="absolute -left-[11px] top-0 grid size-[22px] place-items-center overflow-hidden rounded-full bg-background shadow-[var(--shadow-inset-ring)]">
        {item.author?.avatarUrl
          ? (
              <img
                src={item.author.avatarUrl}
                alt=""
                className="size-[22px] rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
              />
            )
          : <CommentIcon className="size-2.5 text-muted-foreground" aria-hidden="true" />}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="text-[12.5px] font-medium text-foreground/85">{item.author?.login ?? t('timeline.unknownAuthor')}</span>
        <span className="text-[11.5px] text-muted-foreground">{label}</span>
      </div>
      <time className="mt-0.5 block font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatTimestamp(item.createdAt, locale)}
      </time>
      {item.body && (
        <div className="mt-2 rounded-lg bg-muted/40 p-3">
          <AssetMarkdown content={item.body} className="text-pretty text-[12.5px] leading-5 text-foreground/80" />
        </div>
      )}
    </li>
  )
}

function reviewLabel(state: string | null, t: TFunction<'pull-requests'>): string {
  if (state === 'APPROVED') {
    return t('timeline.review.approved')
  }
  if (state === 'CHANGES_REQUESTED') {
    return t('timeline.review.changesRequested')
  }
  if (state === 'DISMISSED') {
    return t('timeline.review.dismissed')
  }
  return t('timeline.review.commented')
}

function CodeTab({ files }: { files: PullRequestFile[] }) {
  const { t } = useTranslation('pull-requests')
  if (files.length === 0) {
    return <p className="pt-6 text-[13px] text-muted-foreground/70">{t('code.noFiles')}</p>
  }

  return (
    <div className="space-y-2 pt-6">
      {files.map(file => (
        <details
          key={file.filename}
          className="group overflow-hidden rounded-lg border border-border/60 [content-visibility:auto]"
        >
          <summary className="flex min-h-9 cursor-default list-none items-center gap-2.5 px-3 py-1.5 text-[11.5px] hover:bg-muted/40">
            <span className="min-w-0 flex-1 truncate font-mono text-foreground/80">{file.filename}</span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              {file.status}
            </span>
            <span className="shrink-0 font-mono tabular-nums text-success">
              +
              {file.additions}
            </span>
            <span className="shrink-0 font-mono tabular-nums text-destructive">
              −
              {file.deletions}
            </span>
          </summary>
          {file.patch
            ? <Patch patch={file.patch} />
            : (
                <div className="border-t border-border/60 px-3 py-3 text-[11px] text-muted-foreground">
                  {t('code.patchUnavailable')}
                </div>
              )}
        </details>
      ))}
    </div>
  )
}

function Patch({ patch }: { patch: string }) {
  return (
    <pre className="overflow-x-auto border-t border-border/60 bg-muted/30 py-2 font-mono text-[10px] leading-5">
      {patch.split('\n').map((line, index) => (
        <code
          // The immutable GitHub patch line number is the stable identity, even when text repeats.
          // eslint-disable-next-line react/no-array-index-key
          key={`${index}:${line}`}
          className={cn(
            'block min-w-max px-3 text-foreground/70',
            line.startsWith('+') && !line.startsWith('+++') && 'bg-success/10 text-success',
            line.startsWith('-') && !line.startsWith('---') && 'bg-destructive/10 text-destructive',
            line.startsWith('@@') && 'bg-info/10 text-info',
          )}
        >
          {line || ' '}
        </code>
      ))}
    </pre>
  )
}

function ChecksValue({ state, count }: { state: string, count: number }) {
  const { t } = useTranslation('pull-requests')
  if (count === 0) {
    return <span className="tabular-nums text-muted-foreground/60">0</span>
  }
  if (state === 'neutral') {
    return <span className="tabular-nums text-muted-foreground">{count}</span>
  }
  const failed = state === 'failure'
  const pending = state === 'pending'
  return (
    <span className={cn(
      'flex items-center gap-1 tabular-nums',
      pending ? 'text-warning' : failed ? 'text-destructive' : 'text-success',
    )}
    >
      {count}
      <span className="font-normal text-muted-foreground/60">
        {pending ? t('check.pending') : failed ? t('check.failed') : t('check.passed')}
      </span>
    </span>
  )
}

function CheckBadge({ status, conclusion }: { status: string, conclusion: string | null }) {
  const { t } = useTranslation('pull-requests')
  const failed = conclusion !== null && [
    'action_required',
    'cancelled',
    'failure',
    'stale',
    'startup_failure',
    'timed_out',
  ].includes(conclusion)
  const pending = status !== 'completed' || conclusion === null
  return (
    <span className={cn(
      'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
      pending ? 'bg-warning/10 text-warning' : failed ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success',
    )}
    >
      {pending ? t('check.pending') : failed ? t('check.failed') : t('check.passed')}
    </span>
  )
}

function PropRow({ icon: Icon, label, children }: { icon: StatusIconType, label: string, children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <dt className="flex w-28 shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
        <Icon className="size-3 shrink-0 text-muted-foreground/50" aria-hidden="true" />
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-foreground/85">
        {children}
      </dd>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-[13px] font-semibold text-foreground/80">{children}</h2>
}

type Person = { login: string, avatarUrl: string, url: string }

// Renders the value of an assignees/reviewers PropRow: avatar chips that wrap
// inside the <dd>, or a muted placeholder when nobody is on the list.
function PeopleValue({ people, empty }: { people: Person[], empty: string }) {
  if (people.length === 0) {
    return <span className="font-normal text-muted-foreground/70">{empty}</span>
  }
  return people.map(person => <PersonChip key={person.login} person={person} />)
}

// Avatar-led chip: the avatar nestles against the left edge (pl-0.5) so the
// chip reads as "this person" rather than a boxed tag. Subtle muted fill
// instead of a border keeps it typographic, matching the page-property idiom.
function PersonChip({ person }: { person: Person }) {
  return (
    <a
      href={person.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted/50 py-0.5 pl-0.5 pr-2 text-[12px] text-foreground/75 transition-colors hover:bg-muted hover:text-foreground"
    >
      <img
        src={person.avatarUrl}
        alt=""
        className="size-5 rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
      />
      <span className="font-medium">{person.login}</span>
    </a>
  )
}

function PullRequestDetailSkeleton() {
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex justify-end px-4 py-2">
        <Skeleton className="size-7 rounded-md" />
      </div>
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 pb-20">
        <Skeleton className="h-3.5 w-1/4" />
        <Skeleton className="mt-3 h-7 w-4/5" />
        <Skeleton className="mt-3 h-3.5 w-2/3" />
        <div className="mt-6 flex gap-1">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
        <div className="mt-6 space-y-2">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-6" />)}
        </div>
        <Skeleton className="mt-8 h-3 w-1/4" />
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-1.5 h-3 w-5/6" />
      </div>
    </div>
  )
}
