import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Badge } from '~/components/ui/badge'

import { kanbanCardFixtures, kanbanDisplayProperties, kanbanRuntimeData, kanbanStatuses } from './fixtures/kanban-cards'
import { KanbanCardView } from './kanban-card-view'
import { KanbanGroupHeader } from './kanban-group-header'
import { AssigneeAvatar } from './shared/assignee-avatar'
import { LabelChip } from './shared/label-chip'
import { ParentIssueLink } from './shared/parent-issue-link'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'

const priorities = ['none', 'low', 'medium', 'high', 'urgent'] as const

function KanbanSurfacesCatalog() {
  const [collapsed, setCollapsed] = useState(false)
  const [activity, setActivity] = useState('No issue action selected')

  return (
    <main className="min-h-[42rem] bg-background px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl space-y-10">
        <section>
          <h1 className="text-xl font-semibold">Kanban surfaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">Cards and issue metadata rendered without board queries, stores, drag runtime, or context menus.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Issue cards</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kanbanCardFixtures.map((issue, index) => (
              <KanbanCardView
                key={issue.id}
                issue={issue}
                statuses={kanbanStatuses}
                displayProperties={kanbanDisplayProperties}
                runtimeData={kanbanRuntimeData}
                selected={index === 0}
                parentIssueRef={index === 1 ? { id: 'issue-71', key: 'CRA-71' } : null}
                onOpenIssue={id => setActivity(`Opened ${id}`)}
              />
            ))}
          </div>
        </section>

        <section className="grid gap-6 border-t border-border pt-8 lg:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Group header</h2>
            <KanbanGroupHeader
              name="In progress"
              count={6}
              category="started"
              collapsed={collapsed}
              onToggle={() => setCollapsed(value => !value)}
              onCreateIssue={() => setActivity('Create issue')}
            />
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-medium">Issue metadata</h2>
            <div className="flex flex-wrap items-center gap-3">
              {kanbanStatuses.map(status => (
                <Badge key={status.id} variant="outline" className="gap-1.5">
                  <StatusIcon category={status.category} size={14} />
                  {status.name}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {priorities.map(priority => (
                <span key={priority} className="flex items-center gap-1 text-xs capitalize text-muted-foreground">
                  <PriorityIcon priority={priority} size={15} />
                  {priority}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {['frontend', 'architecture', 'storybook', 'desktop', 'bug'].map(label => (
                <LabelChip key={label} label={label} />
              ))}
              <AssigneeAvatar name="Wibus" />
              <AssigneeAvatar />
              <ParentIssueLink parentIssueKey="CRA-71" variant="row" onOpen={() => setActivity('Opened CRA-71')} />
            </div>
          </div>
        </section>

        <p className="text-xs text-muted-foreground" role="status">{activity}</p>
      </div>
    </main>
  )
}

const meta = {
  title: 'Kanban/Surfaces',
  component: KanbanSurfacesCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof KanbanSurfacesCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const Catalog: Story = {}
