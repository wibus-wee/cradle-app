import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import {
  claudeRuntimeUsageFixture,
  compactContextUsageFixture,
  contextUsageFixture,
  contextUsageNearLimitFixture,
  runtimeUsageFixture,
} from '../fixtures/context-usage-fixtures'
import { ContextUsageDetailPanelView } from '../views/context-usage-detail-panel-view'
import { ContextWindowViewerView } from '../views/context-window-viewer-view'

interface ContextUsageStorySceneProps {
  state: 'detailed' | 'near-limit' | 'provider-usage' | 'claude-cost' | 'compact' | 'loading' | 'error'
}

function ContextUsageStoryScene({ state }: ContextUsageStorySceneProps) {
  const [lastAction, setLastAction] = useState('No action yet')
  const usage = state === 'near-limit'
    ? contextUsageNearLimitFixture
    : state === 'detailed' || state === 'provider-usage' || state === 'claude-cost' ? contextUsageFixture : null
  const compactState = state === 'compact' ? compactContextUsageFixture : undefined
  const runtimeUsageState = state === 'provider-usage'
    ? runtimeUsageFixture
    : state === 'claude-cost' ? claudeRuntimeUsageFixture : undefined
  const loadState = state === 'loading' ? 'loading' : state === 'error' ? 'error' : 'ready'

  return (
    <main className="grid min-h-screen place-items-center gap-8 bg-background px-6 py-10 text-foreground lg:grid-cols-2">
      <div className="w-full max-w-80 space-y-3">
        <ContextUsageDetailPanelView
          usage={usage}
          compactState={compactState}
          runtimeUsageState={runtimeUsageState}
          loadState={loadState}
          onClose={() => setLastAction('Closed detail panel')}
          onOpenReport={() => setLastAction('Opened context report')}
        />
        <p className="text-xs text-muted-foreground" role="status">{lastAction}</p>
      </div>
      <div className="w-full max-w-sm rounded-lg border border-border bg-sidebar p-4">
        <ContextWindowViewerView
          usage={usage}
          compactState={compactState}
          loadState={loadState}
        />
      </div>
    </main>
  )
}

const meta = {
  title: 'Chat/Context/ContextUsageViews',
  component: ContextUsageStoryScene,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
    docs: {
      description: {
        component: 'Fixture-driven Context views. No session route, query client, store, Electron host, or runtime decorator is mounted.',
      },
    },
  },
  args: { state: 'detailed' },
} satisfies Meta<typeof ContextUsageStoryScene>

export default meta

type Story = StoryObj<typeof meta>

export const Detailed: Story = {}
export const NearLimit: Story = { args: { state: 'near-limit' } }
export const ProviderUsage: Story = { args: { state: 'provider-usage' } }
export const ClaudeCost: Story = { args: { state: 'claude-cost' } }
export const CompactFallback: Story = { args: { state: 'compact' } }
export const Loading: Story = { args: { state: 'loading' } }
export const Error: Story = { args: { state: 'error' } }
