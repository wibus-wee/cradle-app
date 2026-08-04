import type { Meta, StoryObj } from '@storybook/react-vite'
import { useCallback, useState } from 'react'

import { sampleArtifactSource } from '../fixtures/tool-block-fixtures'
import { ArtifactPreviewView } from '../views/artifact-preview-view'

function ArtifactPreviewScene() {
  const [activity, setActivity] = useState('No action selected')
  const handleOpen = useCallback((input: { artifactId: string, title: string, revision: number }) => {
    setActivity(`artifact: ${input.artifactId} · ${input.title} · rev ${input.revision}`)
  }, [])

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-md space-y-4">
        <ArtifactPreviewView
          sessionId="storybook-session"
          artifactId="priority-changes"
          toolCallId="storybook-artifact"
          title="Priority changes"
          source={sampleArtifactSource}
          revision={1}
          onOpen={handleOpen}
        />
        <ArtifactPreviewView
          sessionId="storybook-session"
          artifactId="priority-changes"
          toolCallId="storybook-artifact-rev2"
          title="Priority changes"
          source={sampleArtifactSource}
          revision={2}
          onOpen={handleOpen}
        />
        <ArtifactPreviewView
          sessionId="storybook-session"
          artifactId="priority-changes"
          toolCallId="storybook-artifact-meta-only"
          title="Priority changes"
          revision={3}
          onOpen={handleOpen}
        />
        <div
          className="w-fit rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
          role="status"
        >
          {activity}
        </div>
      </div>
    </main>
  )
}

const meta = {
  title: 'Chat/Tools/ArtifactPreviewView',
  component: ArtifactPreviewScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
    docs: {
      description: {
        component: 'Props-only Artifact chat card. Panel ownership is supplied through onOpen — no session, query, route, or browser-panel store.',
      },
    },
  },
} satisfies Meta<typeof ArtifactPreviewScene>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
