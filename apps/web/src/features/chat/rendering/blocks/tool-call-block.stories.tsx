import type { Meta, StoryObj } from '@storybook/react-vite'
import { useCallback, useState } from 'react'

import type { ChatToolFixture } from '../../fixtures/chat-tools'
import {
  chatToolKindFixtures,
  chatToolStateFixtures,
  chatWorkflowToolFixture,
  groupedFileToolFixtures,
  groupedTerminalToolFixtures,
} from '../../fixtures/chat-tools'
import { GroupedToolCallBlockView } from './grouped-tool-call-block'
import { ToolCallBlockView } from './tool-call-block'

function ToolFixtureRow({
  fixture,
  onActivity,
}: {
  fixture: ChatToolFixture
  onActivity: (activity: string) => void
}) {
  return (
    <div className="min-w-0">
      <div className="px-1 text-[11px] font-medium uppercase text-muted-foreground">
        {fixture.kind}
      </div>
      <ToolCallBlockView
        {...fixture.props}
        onApprovalResponse={response => onActivity(`${response.id}: ${response.approved ? 'approved' : 'denied'}`)}
        onOpenWorkspaceDiff={path => onActivity(`diff: ${path}`)}
        onOpenSubagentOutput={input => onActivity(`subagent: ${input.agentName}`)}
        onOpenWorkflowSurface={input => onActivity(`workflow: ${input.title}`)}
      />
    </div>
  )
}

function ToolGalleryScene({ fixtures }: { fixtures: ChatToolFixture[] }) {
  const [activity, setActivity] = useState('No action selected')
  const handleActivity = useCallback((nextActivity: string) => setActivity(nextActivity), [])

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
          {fixtures.map(fixture => (
            <ToolFixtureRow
              key={`${fixture.kind}-${fixture.props.toolCallId}`}
              fixture={fixture}
              onActivity={handleActivity}
            />
          ))}
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

function GroupedActivityScene() {
  const [activity, setActivity] = useState('No file selected')

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto grid max-w-4xl gap-10 lg:grid-cols-2">
        <section>
          <div className="px-1 text-xs font-medium text-muted-foreground">TERMINAL ACTIVITY</div>
          <GroupedToolCallBlockView
            items={groupedTerminalToolFixtures}
            uiKind="terminal"
            animated={false}
          />
        </section>
        <section>
          <div className="px-1 text-xs font-medium text-muted-foreground">FILE ACTIVITY</div>
          <GroupedToolCallBlockView
            items={groupedFileToolFixtures}
            uiKind="file-diff"
            animated={false}
            onOpenWorkspaceDiff={path => setActivity(path)}
          />
        </section>
        <div className="text-xs text-muted-foreground" role="status">{activity}</div>
      </div>
    </main>
  )
}

const meta = {
  title: 'Chat/Tools/ToolCallBlockView',
  component: ToolGalleryScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
    docs: {
      description: {
        component: 'Props-only tool surfaces driven by canonical Cradle tool envelopes. No session, query, route, Electron, or browser-panel store is required.',
      },
    },
  },
  args: {
    fixtures: chatToolKindFixtures,
  },
} satisfies Meta<typeof ToolGalleryScene>

export default meta

type Story = StoryObj<typeof meta>

export const AllToolKinds: Story = {}

export const LifecycleStates: Story = {
  args: {
    fixtures: chatToolStateFixtures,
  },
}

export const WorkflowSurface: Story = {
  args: {
    fixtures: [chatWorkflowToolFixture],
  },
}

export const GroupedActivity: Story = {
  render: () => <GroupedActivityScene />,
}
