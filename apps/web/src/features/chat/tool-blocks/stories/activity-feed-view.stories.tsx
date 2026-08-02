import type { Meta, StoryObj } from '@storybook/react-vite'
import { useCallback, useState } from 'react'

import {
  activityFeedCompletedFixtures,
  activityFeedErrorFixtures,
  activityFeedMixedFixtures,
  activityFeedReasoningFixtures,
  activityFeedRunningFixtures,
  activityFeedSingleToolFixtures,
} from '../fixtures/tool-block-fixtures'
import type { ActivityFeedViewEntry } from '../views/activity-feed-view'
import { ActivityFeedView } from '../views/activity-feed-view'

function ActivityFeedScene({
  title,
  entries,
  onActivity,
}: {
  title: string
  entries: ActivityFeedViewEntry[]
  onActivity: (activity: string) => void
}) {
  return (
    <section>
      <div className="px-1 text-[11px] font-medium uppercase text-muted-foreground">{title}</div>
      <ActivityFeedView
        entries={entries}
        animated={false}
        onOpenWorkspaceDiff={path => onActivity(`diff: ${path}`)}
        onOpenPlanDocument={input => onActivity(`plan: ${input.toolCallId}`)}
        onOpenArtifact={input => onActivity(`artifact: ${input.artifactId}`)}
      />
    </section>
  )
}

function ActivityFeedGalleryScene() {
  const [activity, setActivity] = useState('No action selected')
  const handleActivity = useCallback((nextActivity: string) => setActivity(nextActivity), [])

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
          <ActivityFeedScene title="Completed" entries={activityFeedCompletedFixtures} onActivity={handleActivity} />
          <ActivityFeedScene title="Running" entries={activityFeedRunningFixtures} onActivity={handleActivity} />
          <ActivityFeedScene title="With error" entries={activityFeedErrorFixtures} onActivity={handleActivity} />
          <ActivityFeedScene title="Reasoning" entries={activityFeedReasoningFixtures} onActivity={handleActivity} />
          <ActivityFeedScene title="Mixed kinds" entries={activityFeedMixedFixtures} onActivity={handleActivity} />
          <ActivityFeedScene title="Single activity" entries={activityFeedSingleToolFixtures} onActivity={handleActivity} />
        </div>
        <div
          className="mt-8 w-fit rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
          role="status"
        >
          {activity}
        </div>
      </div>
    </main>
  )
}

const meta = {
  title: 'Chat/Tools/ActivityFeedView',
  component: ActivityFeedGalleryScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
    docs: {
      description: {
        component: 'Props-only chronological activity feed driven by resolved tool and reasoning entries. No session, query, route, Electron, or browser-panel store is required.',
      },
    },
  },
} satisfies Meta<typeof ActivityFeedGalleryScene>

export default meta

type Story = StoryObj<typeof meta>

export const AllStates: Story = {}

export const CompletedFeed: Story = {
  render: () => (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-2xl">
        <ActivityFeedView entries={activityFeedCompletedFixtures} animated={false} />
      </div>
    </main>
  ),
}

export const RunningFeed: Story = {
  render: () => (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-2xl">
        <ActivityFeedView entries={activityFeedRunningFixtures} />
      </div>
    </main>
  ),
}

export const FeedWithError: Story = {
  render: () => (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-2xl">
        <ActivityFeedView entries={activityFeedErrorFixtures} animated={false} />
      </div>
    </main>
  ),
}

export const SingleActivity: Story = {
  render: () => (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-2xl">
        <ActivityFeedView entries={activityFeedSingleToolFixtures} animated={false} />
      </div>
    </main>
  ),
}
