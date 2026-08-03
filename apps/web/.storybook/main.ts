import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/react-vite'
import { mergeConfig } from 'vite'

const storybookDirectory = dirname(fileURLToPath(import.meta.url))
const reactPath = resolve(storybookDirectory, '../node_modules/react')
const reactDomPath = resolve(storybookDirectory, '../node_modules/react-dom')

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  staticDirs: ['../public'],
  async viteFinal(viteConfig) {
    return mergeConfig(viteConfig, {
      resolve: {
        dedupe: ['react', 'react-dom'],
        alias: {
          '~': resolve(storybookDirectory, '../src'),
          'react': reactPath,
          'react-dom': reactDomPath,
        },
      },
    })
  },
}

export default config
