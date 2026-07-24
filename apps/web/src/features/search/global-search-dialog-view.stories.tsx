import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { globalSearchDataFixtures } from './fixtures/global-search'
import { GlobalSearchDialogView } from './global-search-dialog-view'
import type { PaletteData, PaletteModeId } from './palette/types'

interface GlobalSearchStorySceneProps {
  initialMode: PaletteModeId
  initialQuery: string
  data: PaletteData
}

function GlobalSearchStoryScene({
  initialMode,
  initialQuery,
  data,
}: GlobalSearchStorySceneProps) {
  const [mode, setMode] = useState(initialMode)
  const [query, setQuery] = useState(initialQuery)
  const [activity, setActivity] = useState('No result selected')
  const viewData = {
    ...data,
    hasQuery: query.length > 0,
  }

  return (
    <main className="h-screen bg-muted/25 text-foreground">
      <GlobalSearchDialogView
        mode={mode}
        query={query}
        data={viewData}
        onModeChange={setMode}
        onQueryChange={setQuery}
        onSelectCommand={command => setActivity(`Command: ${command.label}`)}
        onSelectFile={path => setActivity(`File: ${path}`)}
        onSelectThread={sessionId => setActivity(`Conversation: ${sessionId}`)}
        onSelectWorkspace={workspaceId => setActivity(`Workspace: ${workspaceId}`)}
        onSelectIssue={issueId => setActivity(`Issue: ${issueId}`)}
        onDismiss={() => setActivity('Dismissed')}
      />
      <span className="sr-only" role="status">{activity}</span>
    </main>
  )
}

const meta = {
  title: 'App/Search/Global Search Dialog',
  component: GlobalSearchStoryScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
  args: {
    initialMode: 'all',
    initialQuery: '',
    data: globalSearchDataFixtures.landing,
  },
} satisfies Meta<typeof GlobalSearchStoryScene>

export default meta

type Story = StoryObj<typeof meta>

export const Landing: Story = {}

export const AllResults: Story = {
  args: {
    initialQuery: 'component',
    data: globalSearchDataFixtures.allResults,
  },
}

export const Commands: Story = {
  args: {
    initialMode: 'commands',
    initialQuery: 'open',
    data: globalSearchDataFixtures.commands,
  },
}

export const Files: Story = {
  args: {
    initialMode: 'files',
    initialQuery: 'package',
    data: globalSearchDataFixtures.allResults,
  },
}

export const Conversations: Story = {
  args: {
    initialMode: 'threads',
    initialQuery: 'component',
    data: globalSearchDataFixtures.allResults,
  },
}

export const Issues: Story = {
  args: {
    initialMode: 'issues',
    initialQuery: 'search',
    data: globalSearchDataFixtures.allResults,
  },
}

export const Workspaces: Story = {
  args: {
    initialMode: 'workspaces',
    initialQuery: 'cradle',
    data: globalSearchDataFixtures.allResults,
  },
}

export const Pending: Story = {
  args: {
    initialQuery: 'loading',
    data: globalSearchDataFixtures.pending,
  },
}

export const NoResults: Story = {
  args: {
    initialQuery: 'no-matching-surface',
    data: globalSearchDataFixtures.empty,
  },
}
