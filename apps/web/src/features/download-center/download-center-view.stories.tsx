import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Badge } from '~/components/ui/badge'

import { DownloadCenterView } from './download-center-view'
import { DownloadTaskRowView } from './download-task-row-view'
import {
  activeDownloadTask,
  completedDownloadTask,
  downloadTaskCatalog,
  failedDownloadTask,
  queuedDownloadTask,
} from './fixtures/download-tasks'
import type { DownloadTask } from './types'

function DownloadCenterCatalog() {
  const [activity, setActivity] = useState('No download action selected')

  const report = (action: string) => (task: DownloadTask) => {
    setActivity(`${action}: ${task.owner.displayName}`)
  }

  return (
    <main className="min-h-[42rem] bg-background px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <section>
          <h1 className="text-xl font-semibold">Download center</h1>
          <p className="mt-1 text-sm text-muted-foreground">All task lifecycle states and the application chrome popover.</p>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {downloadTaskCatalog.map(task => (
            <div key={task.taskId} className="space-y-2">
              <Badge variant="outline" className="capitalize">{task.status}</Badge>
              <DownloadTaskRowView
                task={task}
                showFileName
                onCancel={report('Cancel')}
                onRetry={report('Retry')}
              />
            </div>
          ))}
        </section>

        <section className="flex items-center justify-between border-t border-border pt-6">
          <div>
            <h2 className="text-sm font-medium">Chrome popover</h2>
            <p className="mt-1 text-xs text-muted-foreground">Open to inspect mixed active and recent tasks.</p>
          </div>
          <DownloadCenterView
            active={[queuedDownloadTask, activeDownloadTask]}
            recent={[failedDownloadTask, completedDownloadTask]}
            onCancel={report('Cancel')}
            onRetry={report('Retry')}
            onViewAll={() => setActivity('View all downloads')}
          />
        </section>

        <p className="text-xs text-muted-foreground" role="status">{activity}</p>
      </div>
    </main>
  )
}

const meta = {
  title: 'App/Download Center',
  component: DownloadCenterCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof DownloadCenterCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const Catalog: Story = {}

export const PopoverOpen: Story = {
  render: () => (
    <main className="flex min-h-[34rem] justify-end bg-background p-8 text-foreground">
      <DownloadCenterView
        active={[queuedDownloadTask, activeDownloadTask]}
        recent={[failedDownloadTask, completedDownloadTask]}
        onCancel={() => {}}
        onRetry={() => {}}
        onViewAll={() => {}}
        defaultOpen
      />
    </main>
  ),
}
