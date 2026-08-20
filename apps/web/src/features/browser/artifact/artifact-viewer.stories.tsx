import type { Meta, StoryObj } from '@storybook/react-vite'

import { sampleArtifactSource } from '../../chat/tool-blocks/fixtures/tool-block-fixtures'
import { ArtifactViewer } from './artifact-viewer'

function ArtifactViewerScene({
  source = sampleArtifactSource,
  showSource = true,
}: {
  source?: string
  showSource?: boolean
}) {
  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="relative mx-auto h-[640px] max-w-3xl overflow-hidden rounded-md border border-border shadow-sm">
        <ArtifactViewer
          sessionId="storybook-session"
          artifactId="priority-changes"
          title="Priority changes"
          source={source}
          revision={1}
          showSource={showSource}
          refreshFromServer={false}
        />
      </div>
    </main>
  )
}

const meta = {
  title: 'App/Browser/ArtifactViewer',
  component: ArtifactViewerScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
    docs: {
      description: {
        component: 'Fixture-driven Artifact host. Compiles cradle/artifact JSX in-process — no chat session or browser-panel store.',
      },
    },
  },
  args: {
    source: sampleArtifactSource,
    showSource: true,
  },
} satisfies Meta<typeof ArtifactViewerScene>

export default meta

type Story = StoryObj<typeof meta>

export const Preview: Story = {}

export const PreviewOnly: Story = {
  args: {
    showSource: false,
  },
}

export const CompileError: Story = {
  args: {
    source: `
import { Artifact } from 'cradle/artifact'
import fs from 'fs'

export default function Broken() {
  return <Artifact title="broken" />
}
`.trim(),
  },
}
