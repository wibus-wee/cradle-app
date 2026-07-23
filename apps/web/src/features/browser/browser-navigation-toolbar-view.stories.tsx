import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { BrowserNavigationToolbarView } from './browser-navigation-toolbar-view'
import {
  browserAddressSuggestionFixtures,
  browserLoadingTabFixture,
  browserWebTabFixture,
} from './fixtures/browser-panel-tabs'

const meta = {
  title: 'App/Browser/Navigation Toolbar',
  component: BrowserNavigationToolbarView,
  decorators: [
    Story => (
      <main className="h-screen min-h-40 bg-background">
        <Story />
      </main>
    ),
  ],
  args: {
    activeTab: browserWebTabFixture,
    addressValue: 'https://cradle.dev/docs',
    suggestions: [],
    suggestionsOpen: false,
    nativeBrowserAvailable: true,
    annotationActive: false,
    onBack: fn(),
    onForward: fn(),
    onReload: fn(),
    onAddressChange: fn(),
    onAddressFocus: fn(),
    onAddressBlur: fn(),
    onAddressSubmit: fn(event => event.preventDefault()),
    onSuggestionSelect: fn(),
    onCaptureScreenshot: fn(),
    onToggleAnnotation: fn(),
  },
} satisfies Meta<typeof BrowserNavigationToolbarView>

export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}

export const AddressSuggestions: Story = {
  args: {
    addressValue: 'storybook',
    suggestions: browserAddressSuggestionFixtures,
    suggestionsOpen: true,
  },
}

export const Loading: Story = {
  args: {
    activeTab: browserLoadingTabFixture,
    addressValue: 'https://developer.mozilla.org',
  },
}

export const AnnotationActive: Story = {
  args: {
    annotationActive: true,
  },
}

export const NativeUnavailable: Story = {
  args: {
    nativeBrowserAvailable: false,
  },
}

export const LongAddress: Story = {
  args: {
    addressValue:
      'https://example.com/design-system/components/browser/navigation-toolbar?mode=fixture-driven',
  },
}
