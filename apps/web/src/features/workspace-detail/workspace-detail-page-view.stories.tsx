import {
  ArrowUpLine,
  CheckCircleLine,
  CodeLine,
  FileLine,
} from '@mingcute/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { cn } from '~/lib/cn'

import {
  localWorkspaceDetailFixture,
  remoteWorkspaceDetailFixture,
  workspaceAgentsFixture,
  workspaceAgentsHeadingsFixture,
} from './fixtures/workspace-detail'
import { WorkspaceDetailLoadingView } from './workspace-detail-loading-view'
import { WorkspaceDetailPageView } from './workspace-detail-page-view'
import type {
  WorkspaceDetailDocumentState,
  WorkspaceDetailTab,
} from './workspace-detail-types'

interface WorkspaceDetailStorySceneProps {
  remote?: boolean
  initialTab?: WorkspaceDetailTab
  documentState?: 'ready' | 'empty' | 'loading' | 'saving'
}

function WorkspaceDetailStoryScene({
  remote = false,
  initialTab = 'overview',
  documentState = 'ready',
}: WorkspaceDetailStorySceneProps) {
  const [activeTab, setActiveTab] = useState(initialTab)
  const [savedContent, setSavedContent] = useState(workspaceAgentsFixture)
  const workspace = remote
    ? remoteWorkspaceDetailFixture
    : localWorkspaceDetailFixture
  const agentsDocument: WorkspaceDetailDocumentState = {
    content: documentState === 'empty' || documentState === 'loading'
      ? null
      : savedContent,
    loading: documentState === 'loading',
    saving: documentState === 'saving',
    save: async content => setSavedContent(content),
  }

  const workflowRulesContent = (
    <section className="space-y-4" aria-label="Workflow rules">
      <div>
        <p className="text-sm font-medium text-foreground">Workflow rules</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Applied to every agent session in this workspace.
        </p>
      </div>
      <div className="rounded-md border border-border bg-muted/20 p-4 font-mono text-xs leading-6 text-foreground">
        <p># Delivery</p>
        <p>Commit verified changes and keep the draft pull request current.</p>
        <p className="mt-3"># Review</p>
        <p>Check desktop and mobile Storybook scenes before handoff.</p>
      </div>
    </section>
  )
  const skillsContent = (
    <section className="space-y-3" aria-label="Workspace skills">
      {[
        {
          name: 'component-architecture',
          description: 'Extract dependency seams and fixture-driven Views.',
          icon: CodeLine,
        },
        {
          name: 'release-check',
          description: 'Verify local checks and delivery status.',
          icon: CheckCircleLine,
        },
      ].map(({ name, description, icon: Icon }) => (
        <div
          key={name}
          className="flex items-start gap-3 border-b border-border/70 py-3 last:border-b-0"
        >
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
      ))}
    </section>
  )
  const composer = (
    <div className="rounded-lg border border-border bg-background p-2 shadow-lg">
      <div className="flex min-h-12 items-center gap-2 px-2">
        <FileLine className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          Ask about this workspace...
        </span>
        <button
          type="button"
          title="Send"
          aria-label="Send"
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md',
            'bg-foreground text-background',
          )}
        >
          <ArrowUpLine className="size-4" />
        </button>
      </div>
    </div>
  )

  return (
    <main className="h-screen bg-background text-foreground">
      <WorkspaceDetailPageView
        workspace={workspace}
        activeTab={activeTab}
        agentsDocument={agentsDocument}
        headings={
          activeTab === 'overview' && agentsDocument.content
            ? workspaceAgentsHeadingsFixture
            : []
        }
        showWorkflowRules
        workflowRulesContent={workflowRulesContent}
        skillsContent={skillsContent}
        composer={composer}
        onRename={() => {}}
        onTabChange={setActiveTab}
      />
    </main>
  )
}

const meta = {
  title: 'App/Workspace/Workspace Detail',
  component: WorkspaceDetailStoryScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof WorkspaceDetailStoryScene>

export default meta

type Story = StoryObj<typeof meta>

export const Overview: Story = {}

export const RemoteWorkspace: Story = {
  args: {
    remote: true,
  },
}

export const EmptyInstructions: Story = {
  args: {
    documentState: 'empty',
  },
}

export const LoadingInstructions: Story = {
  args: {
    documentState: 'loading',
  },
}

export const SavingInstructions: Story = {
  args: {
    documentState: 'saving',
  },
}

export const WorkflowRules: Story = {
  args: {
    initialTab: 'workflow-rules',
  },
}

export const Skills: Story = {
  args: {
    initialTab: 'skills',
  },
}

export const LoadingPage: Story = {
  render: () => (
    <main className="h-screen bg-background">
      <WorkspaceDetailLoadingView />
    </main>
  ),
}
