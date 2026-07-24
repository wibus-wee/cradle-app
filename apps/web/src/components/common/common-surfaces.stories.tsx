import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { BetaNotice } from './beta-notice'
import { ProviderIcon } from './provider-icons'
import { RouteErrorView } from './route-error-view'
import { WorkspaceFileIcon, WorkspaceFileIconSpriteSheet } from './workspace-file-icon'

function CommonSurfacesGallery() {
  const [activity, setActivity] = useState('No recovery action selected')

  return (
    <main className="min-h-screen bg-background text-foreground">
      <BetaNotice
        title="Experimental runtime"
        description="This provider may expose capabilities that are still evolving."
      />
      <div className="mx-auto max-w-5xl space-y-10 px-5 py-8 sm:px-8">
        <section className="space-y-4">
          <div>
            <h1 className="text-xl font-semibold">Cradle common surfaces</h1>
            <p className="mt-1 text-sm text-muted-foreground">Shared application-level UI with app semantics but no feature data ownership.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['anthropic', 'Anthropic'],
              ['claude-cli', 'Claude Code'],
              ['codex', 'Codex'],
              ['openai', 'OpenAI'],
              ['hijarvis', 'Hi Jarvis'],
              ['custom', 'Custom runtime'],
            ].map(([presetId, label]) => (
              <div key={presetId} className="flex items-center gap-3 border-b border-border py-3">
                <ProviderIcon presetId={presetId} className="size-5" />
                <span className="text-sm">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Workspace file language</h2>
            <p className="mt-1 text-sm text-muted-foreground">The same icon resolver used by mentions, file trees, and change lists.</p>
          </div>
          <WorkspaceFileIconSpriteSheet />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[
              'src/app.tsx',
              'src/styles.css',
              'package.json',
              'README.md',
              'fixtures/chat-tools.ts',
              'analysis/tool-coverage.ipynb',
            ].map(path => (
              <div key={path} className="flex min-w-0 items-center gap-2 rounded-md bg-muted/45 px-3 py-2">
                <WorkspaceFileIcon path={path} />
                <span className="truncate font-mono text-xs">{path}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="min-h-96 overflow-hidden rounded-lg border border-border">
          <RouteErrorView
            title="This surface could not be opened"
            description="The rest of the application is still available. Retry the route or return home."
            messageLabel="Error"
            message="Failed to load workspace metadata: connection closed before a response was received."
            retryLabel="Retry"
            homeLabel="Back to home"
            detailsLabel="Technical details"
            details="Error: workspace query failed\n    at loadWorkspace (workspace-route.tsx:42:11)"
            onRetry={() => setActivity('Retry selected')}
            onHome={() => setActivity('Home selected')}
          />
        </section>
        <div className="text-xs text-muted-foreground" role="status">{activity}</div>
      </div>
    </main>
  )
}

const meta = {
  title: 'App/Common Surfaces',
  component: CommonSurfacesGallery,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof CommonSurfacesGallery>

export default meta

type Story = StoryObj<typeof meta>

export const Catalog: Story = {}
