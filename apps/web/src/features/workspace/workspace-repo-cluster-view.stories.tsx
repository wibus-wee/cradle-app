import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { WorkspaceRepoClusterView } from './workspace-repo-cluster-view'
import type { RepoWorkspaceShadow } from './workspace-repo-clusters'

const shadows: RepoWorkspaceShadow[] = [
  {
    nodeId: 'desktop',
    nodeName: 'Desktop',
    path: '/home/y/cradle-app',
    sourceWorkspaceId: 'remote-2',
  },
  {
    nodeId: 'lab-server',
    nodeName: 'Lab Server',
    path: '/srv/cradle-app',
    kind: 'project',
  },
]

function WorkspaceRepoClusterCatalog() {
  const [expanded, setExpanded] = useState(true)
  const [mountingKey, setMountingKey] = useState<string | null>(null)
  const [activity, setActivity] = useState('No shadow mounted')

  return (
    <main className="min-h-screen bg-muted/20 p-4 text-foreground sm:p-8">
      <section className="mx-auto w-full max-w-80 border border-sidebar-border bg-sidebar p-2 shadow-sm">
        <div className="px-2.5 pb-2 pt-1 text-[11px] font-medium text-muted-foreground">
          Repository cluster
        </div>
        <WorkspaceRepoClusterView
          name="cradle-app"
          replicaCount={3}
          expanded={expanded}
          shadows={shadows}
          mountingKey={mountingKey}
          onToggleExpanded={() => setExpanded(current => !current)}
          onMountShadow={(shadow) => {
            setActivity(`Mounted ${shadow.nodeName}`)
            setMountingKey(`${shadow.nodeId}:${shadow.path}`)
            window.setTimeout(setMountingKey, 1200, null)
          }}
        >
          <div className="ml-4.25 border-l border-sidebar-border/50 py-0.5 pl-2 text-xs text-muted-foreground">
            Replica workspace groups render here, each with its machine label.
          </div>
        </WorkspaceRepoClusterView>
      </section>
      <p className="sr-only" role="status">{activity}</p>
    </main>
  )
}

const meta = {
  title: 'App/Workspace/Workspace Repo Cluster',
  component: WorkspaceRepoClusterCatalog,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof WorkspaceRepoClusterCatalog>

export default meta
type Story = StoryObj<typeof meta>

export const States: Story = {}
