import '../src/styles.css'

import type { Preview } from '@storybook/react-vite'

import { PreviewSurface } from './preview-surface'

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Cradle color theme',
      toolbar: {
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  decorators: [
    (Story, context) => (
      <PreviewSurface theme={context.globals.theme === 'dark' ? 'dark' : 'light'}>
        <Story />
      </PreviewSurface>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
    a11y: { test: 'todo' },
  },
}

export default preview
