import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import { BrowserAnnotationRailView } from './browser-annotation-rail-view'
import { browserAnnotationFixtures } from './fixtures/browser-annotations'

function InteractiveAnnotationRail() {
  const [annotations, setAnnotations] = useState(
    browserAnnotationFixtures,
  )
  const [collapsed, setCollapsed] = useState(false)

  return (
    <BrowserAnnotationRailView
      annotations={[...annotations]}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      onClear={() => setAnnotations([])}
      onEdit={() => {}}
      onDelete={annotationId =>
        setAnnotations(current =>
          current.filter(annotation => annotation.id !== annotationId))}
      onSend={() => {}}
    />
  )
}

const meta = {
  title: 'App/Browser/Annotation Rail',
  component: BrowserAnnotationRailView,
  decorators: [
    Story => (
      <main className="relative h-screen min-h-96 overflow-hidden bg-muted/30">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:32px_32px] opacity-30" />
        <Story />
      </main>
    ),
  ],
  args: {
    annotations: [...browserAnnotationFixtures],
    collapsed: false,
    onCollapsedChange: fn(),
    onClear: fn(),
    onEdit: fn(),
    onDelete: fn(),
    onSend: fn(),
  },
} satisfies Meta<typeof BrowserAnnotationRailView>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = {
  render: () => <InteractiveAnnotationRail />,
  parameters: {
    controls: { disable: true },
  },
}

export const Expanded: Story = {}

export const Collapsed: Story = {
  args: {
    collapsed: true,
  },
}

export const Saved: Story = {
  args: {
    annotations: [browserAnnotationFixtures[0]],
  },
}

export const Sent: Story = {
  args: {
    annotations: [browserAnnotationFixtures[1]],
  },
}

export const Empty: Story = {
  args: {
    annotations: [],
  },
}
