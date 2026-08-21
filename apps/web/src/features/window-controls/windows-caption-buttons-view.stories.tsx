import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { CaptionButtonId } from './windows-caption-buttons-view'
import { WindowsCaptionButtonsView } from './windows-caption-buttons-view'

const labels = {
  minimize: 'Minimize',
  maximize: 'Maximize',
  restore: 'Restore',
  close: 'Close',
}

const meta = {
  title: 'Features/WindowControls/WindowsCaptionButtonsView',
  component: WindowsCaptionButtonsView,
  args: {
    maximized: false,
    hoveredButton: null,
    pressedButton: null,
    labels,
    onRectsChange: fn(),
    onButtonClick: fn(),
  },
} satisfies Meta<typeof WindowsCaptionButtonsView>

export default meta

type Story = StoryObj<typeof meta>

function WithHeaderBackground(story: () => React.ReactNode) {
  return (
    <div className="flex h-11 w-[420px] items-center bg-sidebar pe-0 pl-1">
      <div className="flex-1" />
      {story()}
    </div>
  )
}

export const Default: Story = {
  decorators: [WithHeaderBackground],
}

export const Maximized: Story = {
  decorators: [WithHeaderBackground],
  args: {
    maximized: true,
  },
}

export const HoveredMaximize: Story = {
  decorators: [WithHeaderBackground],
  args: {
    hoveredButton: 'maximize' satisfies CaptionButtonId,
  },
}

export const PressedClose: Story = {
  decorators: [WithHeaderBackground],
  args: {
    hoveredButton: 'close' satisfies CaptionButtonId,
    pressedButton: 'close' satisfies CaptionButtonId,
  },
}

export const HoveredClose: Story = {
  decorators: [WithHeaderBackground],
  args: {
    hoveredButton: 'close' satisfies CaptionButtonId,
  },
}
