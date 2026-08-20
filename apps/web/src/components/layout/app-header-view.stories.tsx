import { Search2Line as SearchIcon } from '@mingcute/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { Button } from '~/components/ui/button'
import { SessionPullRequestChromeView } from '~/features/session/session-pull-request-chrome-view'
import { workDetailFixture } from '~/features/work/fixtures/work-detail'
import { WorkHeaderChromeView } from '~/features/work/work-header-chrome-view'

import { AppHeaderView } from './app-header-view'

const sidebar = {
  inSheet: false,
  sheetOpen: false,
  collapsed: false,
  toggleLabel: 'Collapse sidebar',
  collapsedWindowControlsOffset: 0,
  onToggle: fn(),
}

const windowControls = {
  leftReservedWidth: 0,
  rightReservedWidth: 0,
}

const surface = (
  <div className="flex h-full min-w-0 items-center gap-1 px-2">
    <span className="truncate text-[13px] font-medium">Component architecture</span>
    <span className="text-xs text-muted-foreground">/ Storybook views</span>
  </div>
)

const meta = {
  title: 'Layout/AppHeaderView',
  component: AppHeaderView,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    sidebar,
    windowControls,
    surface,
    actions: <Button variant="ghost" size="icon-xs" aria-label="Search"><SearchIcon /></Button>,
    browserPanel: {
      label: 'Toggle browser panel',
      open: false,
      onToggle: fn(),
    },
    bottomPanel: {
      label: 'Toggle bottom panel',
      open: true,
      onToggle: fn(),
    },
    aside: {
      label: 'Toggle right panel',
      open: false,
      onToggle: fn(),
    },
  },
} satisfies Meta<typeof AppHeaderView>

export default meta

type Story = StoryObj<typeof meta>

export const Standard: Story = {}

export const CollapsedSidebar: Story = {
  args: {
    sidebar: {
      ...sidebar,
      collapsed: true,
      toggleLabel: 'Expand sidebar',
      collapsedWindowControlsOffset: 34,
    },
  },
}

export const SheetSidebarOpen: Story = {
  args: {
    sidebar: {
      ...sidebar,
      inSheet: true,
      sheetOpen: true,
      toggleLabel: 'Close sidebar',
    },
  },
}

export const SessionScoped: Story = {
  args: {
    surface: (
      <div className="flex h-full min-w-0 items-center gap-2 px-2">
        <span className="truncate text-[13px] font-medium">Refactor component seams</span>
        <SessionPullRequestChromeView
          pullRequest={workDetailFixture.pullRequest}
          statusLabel="Draft"
          markReadyLabel="Mark ready"
          markingReadyLabel="Marking ready..."
          onMarkReady={fn()}
        />
      </div>
    ),
  },
}

export const WorkDelivery: Story = {
  args: {
    actions: (
      <WorkHeaderChromeView
        pullRequest={workDetailFixture.pullRequest}
        pullRequestStatusLabel="Draft"
        showPublish
        canSubmit
        blockedReason={null}
        submitLabel="Update Draft"
        markReadyLabel="Mark ready"
        markingReadyLabel="Marking ready..."
        onSubmit={fn()}
        onMarkReady={fn()}
      />
    ),
  },
}

export const SettingsDrillIn: Story = {
  args: {
    isDrillIn: true,
    surface: (
      <div className="flex h-full items-center px-2 text-[13px] font-medium">
        Settings / Integrations
      </div>
    ),
    browserPanel: null,
    bottomPanel: null,
    aside: null,
  },
}
