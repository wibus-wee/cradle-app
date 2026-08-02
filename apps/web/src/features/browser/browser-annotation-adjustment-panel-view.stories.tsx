import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { fn } from 'storybook/test'

import type { BrowserAnnotationDesignChange } from '~/store/browser-panel'

import type { BrowserAnnotationInspectorTab } from './browser-annotation-adjustment-panel-view'
import {
  BrowserAnnotationAdjustmentPanelView,
} from './browser-annotation-adjustment-panel-view'
import {
  browserAnnotationDesignChangesFixture,
  browserAnnotationSelectedElementFixture,
} from './fixtures/browser-annotation-adjustment'

function InteractiveAdjustmentPanel({
  initialTab = 'design' as BrowserAnnotationInspectorTab,
  initialChanges = browserAnnotationDesignChangesFixture,
}: {
  initialTab?: BrowserAnnotationInspectorTab
  initialChanges?: BrowserAnnotationDesignChange
}) {
  const [activeTab, setActiveTab] = useState<BrowserAnnotationInspectorTab>(initialTab)
  const [designChanges, setDesignChanges] = useState<BrowserAnnotationDesignChange>(initialChanges)

  return (
    <BrowserAnnotationAdjustmentPanelView
      selectedElement={browserAnnotationSelectedElementFixture}
      designChanges={designChanges}
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      onDesignChange={(key, value) => {
        setDesignChanges(current => ({ ...current, [key]: value }))
      }}
      onDesignReset={(key) => {
        setDesignChanges((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }}
      onApply={() => {}}
    />
  )
}

const meta = {
  title: 'App/Browser/Annotation Adjustment Panel',
  component: BrowserAnnotationAdjustmentPanelView,
  decorators: [
    Story => (
      <main className="flex h-screen min-h-96 justify-end bg-muted/30 p-4">
        <div className="h-full w-[320px] overflow-hidden rounded-2xl border border-border/70 bg-background shadow-[0_16px_40px_rgba(0,0,0,0.12)]">
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    selectedElement: browserAnnotationSelectedElementFixture,
    designChanges: browserAnnotationDesignChangesFixture,
    activeTab: 'design',
    onActiveTabChange: fn(),
    onDesignChange: fn(),
    onDesignReset: fn(),
    onApply: fn(),
  },
} satisfies Meta<typeof BrowserAnnotationAdjustmentPanelView>

export default meta
type Story = StoryObj<typeof meta>

export const Interactive: Story = {
  render: () => <InteractiveAdjustmentPanel />,
  parameters: {
    controls: { disable: true },
  },
}

export const DesignWithDrafts: Story = {}

export const CssTab: Story = {
  args: {
    activeTab: 'css',
  },
}

export const Empty: Story = {
  args: {
    selectedElement: null,
    designChanges: {},
  },
}

export const NoDrafts: Story = {
  args: {
    designChanges: {},
  },
}
