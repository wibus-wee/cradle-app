import {
  GitBranchLine as BranchIcon,
  GitPullRequestLine as PullRequestIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { newWorkWorkspaceFixtures } from '~/features/new-work/fixtures/new-work'
import {
  pullRequestEntriesFixture,
  pullRequestFixtureNow,
} from '~/features/pull-requests/fixtures/pull-requests'
import { PullRequestRowView } from '~/features/pull-requests/pull-request-row-view'
import { cn } from '~/lib/cn'

import type { GithubRequiredFeature } from './github-required-dialog-store'

export interface GithubRequiredFixturePreviewProps {
  feature: GithubRequiredFeature
}

/** Decorative, non-interactive preview of the gated surface. */
export function GithubRequiredFixturePreview({ feature }: GithubRequiredFixturePreviewProps) {
  if (feature === 'new-work') {
    return <NewWorkFixturePreview />
  }
  return <PullRequestsFixturePreview />
}

function PullRequestsFixturePreview() {
  const { t } = useTranslation('workspace')
  const items = pullRequestEntriesFixture.slice(0, 3)

  return (
    <div
      className="overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm"
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <PullRequestIcon className="size-3.5 text-muted-foreground" />
        <span className="text-[12px] font-medium text-foreground">{t('githubRequired.fixture.pullRequests.title')}</span>
        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{items.length}</span>
      </div>
      <ul className="pointer-events-none flex flex-col gap-0.5 p-1.5">
        {items.map(item => (
          <li key={item.id}>
            <PullRequestRowView
              item={item}
              active={false}
              locale="en"
              now={pullRequestFixtureNow}
              onPrefetch={() => {}}
              onSelect={() => {}}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function NewWorkFixturePreview() {
  const { t } = useTranslation('workspace')
  const workspace = newWorkWorkspaceFixtures[0]

  return (
    <div
      className="overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm"
      aria-hidden="true"
    >
      <div className="border-b border-border/60 px-3 py-2.5">
        <p className="text-[12px] font-medium text-foreground">{t('nav.newWork')}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('githubRequired.fixture.newWork.hint')}</p>
      </div>
      <div className="pointer-events-none space-y-3 p-3">
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">{t('githubRequired.fixture.newWork.workspace')}</p>
          <p className="mt-0.5 truncate text-[13px] font-medium text-foreground">{workspace.name}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {workspace.locator.path}
          </p>
        </div>
        <div className="rounded-lg border border-border/60 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">{t('githubRequired.fixture.newWork.branch')}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-foreground">
            <BranchIcon className="size-3.5 text-muted-foreground" />
            <span className="font-mono">{workspace.gitIdentity?.branch ?? 'main'}</span>
          </p>
        </div>
        <div className={cn('rounded-lg border border-dashed border-border/70 bg-muted/20 px-3 py-3')}>
          <p className="text-[12px] text-muted-foreground">
            {t('githubRequired.fixture.newWork.prompt')}
          </p>
        </div>
      </div>
    </div>
  )
}
