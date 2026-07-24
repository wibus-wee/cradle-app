import {
  CheckCircleLine as CheckCircleIcon,
  EyeLine as ReviewIcon,
  GitCommitLine as GitCommitIcon,
  GitCompareLine as FileDiffIcon,
  Message1Line as CommentIcon,
  User2Line as UserAssignIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { AssetMarkdown } from '~/features/assets/asset-markdown'
import { cn } from '~/lib/cn'

import type { PullRequestDetail } from './api/pull-requests'
import { PullRequestCheckBadgeView } from './pull-request-check-badge-view'
import { PullRequestChecksValueView } from './pull-request-checks-value-view'
import { PullRequestPeopleValueView } from './pull-request-people-value-view'
import { PullRequestPropertyRowView } from './pull-request-property-row-view'
import { PullRequestSectionHeadingView } from './pull-request-section-heading-view'
import { PullRequestSummaryHeaderView } from './pull-request-summary-header-view'

export interface PullRequestSummaryViewProps {
  detail: PullRequestDetail
  now: number
}

export function PullRequestSummaryView({
  detail,
  now,
}: PullRequestSummaryViewProps) {
  const { t } = useTranslation('pull-requests')
  const pullRequest = detail.pullRequest

  return (
    <div className="pt-5">
      <PullRequestSummaryHeaderView pullRequest={pullRequest} now={now} />

      <div className="space-y-8 pt-6">
        <dl>
          <PullRequestPropertyRowView icon={GitCommitIcon} label={t('summary.commits')}>
            <span className="tabular-nums">{pullRequest.commits}</span>
          </PullRequestPropertyRowView>
          <PullRequestPropertyRowView icon={CommentIcon} label={t('summary.comments')}>
            <span className="tabular-nums">
              {pullRequest.comments + pullRequest.reviewComments}
            </span>
          </PullRequestPropertyRowView>
          <PullRequestPropertyRowView icon={FileDiffIcon} label={t('summary.changedFiles')}>
            <span className="tabular-nums">{pullRequest.changedFiles}</span>
            <span className="ml-2 font-mono text-[11px] text-success">
              +
              {pullRequest.additions}
            </span>
            <span className="font-mono text-[11px] text-destructive">
              -
              {pullRequest.deletions}
            </span>
          </PullRequestPropertyRowView>
          <PullRequestPropertyRowView icon={CheckCircleIcon} label={t('summary.checks')}>
            <PullRequestChecksValueView
              state={pullRequest.checksState}
              count={pullRequest.checks.length}
            />
          </PullRequestPropertyRowView>
          <PullRequestPropertyRowView icon={UserAssignIcon} label={t('summary.assignees')}>
            <PullRequestPeopleValueView
              people={pullRequest.assignees}
              empty={t('summary.noAssignees')}
            />
          </PullRequestPropertyRowView>
          <PullRequestPropertyRowView icon={ReviewIcon} label={t('summary.reviewers')}>
            <PullRequestPeopleValueView
              people={pullRequest.reviewers}
              empty={t('summary.noReviewers')}
            />
          </PullRequestPropertyRowView>
        </dl>

        <section>
          <PullRequestSectionHeadingView>
            {t('summary.description')}
          </PullRequestSectionHeadingView>
          {pullRequest.body
            ? (
                <AssetMarkdown
                  content={pullRequest.body}
                  className="text-pretty text-[14px] leading-7 text-foreground/85"
                />
              )
            : (
                <p className="text-[13px] italic text-muted-foreground/70">
                  {t('summary.noDescription')}
                </p>
              )}
        </section>

        {pullRequest.checks.length > 0
          ? (
              <section>
                <PullRequestSectionHeadingView>
                  {t('summary.checks')}
                </PullRequestSectionHeadingView>
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
                      <PullRequestCheckBadgeView
                        status={check.status}
                        conclusion={check.conclusion}
                      />
                    </a>
                  ))}
                </div>
              </section>
            )
          : null}
      </div>
    </div>
  )
}
