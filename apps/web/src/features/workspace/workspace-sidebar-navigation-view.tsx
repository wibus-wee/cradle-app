import {
  CalendarTimeAddLine as AutomationIcon,
  ChartBar2Line as UsageIcon,
  Chat1Line as NewChatIcon,
  FileNewLine as DiffIcon,
  GitPullRequestLine as WorkIcon,
  SearchLine as SearchIcon,
  Settings2Line as SettingsIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { TooltipProvider } from '~/components/ui/tooltip'

import { WorkspaceSidebarNavItemView } from './workspace-sidebar-nav-item-view'

export interface WorkspaceSidebarNavigationViewProps {
  collapsed: boolean
  pullRequestsActive: boolean
  onNewWork: () => void
  onNewChat: () => void
  onSearch: () => void
  onDiff: () => void
  onPullRequests: () => void
  onAutomation: () => void
  onUsage: () => void
  onSettings: () => void
}

export function WorkspaceSidebarNavigationView({
  collapsed,
  pullRequestsActive,
  onNewWork,
  onNewChat,
  onSearch,
  onDiff,
  onPullRequests,
  onAutomation,
  onUsage,
  onSettings,
}: WorkspaceSidebarNavigationViewProps) {
  const { t } = useTranslation('workspace')

  return (
    <TooltipProvider delayDuration={collapsed ? 0 : 600}>
      <nav className="flex flex-col gap-0.5 px-2 pb-2 pt-1">
        <WorkspaceSidebarNavItemView
          icon={<WorkIcon className="size-3.5" />}
          label={t('nav.newWork')}
          collapsed={collapsed}
          onClick={onNewWork}
          dataTestId="nav-new-work"
        />
        <WorkspaceSidebarNavItemView
          icon={<NewChatIcon className="size-3.5" />}
          label={t('nav.newChat')}
          collapsed={collapsed}
          onClick={onNewChat}
          dataTestId="nav-new-chat"
        />
        <WorkspaceSidebarNavItemView
          icon={<SearchIcon className="size-3.5" />}
          label={t('nav.search')}
          shortcut="⌘P"
          collapsed={collapsed}
          onClick={onSearch}
          dataTestId="nav-search"
        />
        <WorkspaceSidebarNavItemView
          icon={<DiffIcon className="size-3.5" />}
          label={t('nav.diffs')}
          collapsed={collapsed}
          onClick={onDiff}
          dataTestId="nav-diffs"
        />
        <WorkspaceSidebarNavItemView
          icon={<WorkIcon className="size-3.5" />}
          label={t('nav.pullRequests')}
          collapsed={collapsed}
          active={pullRequestsActive}
          onClick={onPullRequests}
          dataTestId="nav-pull-requests"
        />
        <WorkspaceSidebarNavItemView
          icon={<AutomationIcon className="size-3.5" />}
          label={t('nav.automation')}
          collapsed={collapsed}
          onClick={onAutomation}
          dataTestId="nav-automation"
        />
        <WorkspaceSidebarNavItemView
          icon={<UsageIcon className="size-3.5" />}
          label={t('nav.usage')}
          collapsed={collapsed}
          onClick={onUsage}
          dataTestId="nav-usage"
        />
        <WorkspaceSidebarNavItemView
          icon={<SettingsIcon className="size-3.5" />}
          label={t('nav.settings')}
          shortcut="⌘,"
          collapsed={collapsed}
          onClick={onSettings}
          dataTestId="settings-btn"
        />
      </nav>
    </TooltipProvider>
  )
}
