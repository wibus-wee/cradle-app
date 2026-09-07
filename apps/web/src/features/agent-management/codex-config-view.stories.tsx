import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { CodexConfigView } from './codex-config-view'

const meta = {
  title: 'Agent Management/CodexConfigView',
  component: CodexConfigView,
  args: {
    initialValue: '{}',
    schema: {
      version: '0.153.4',
      releaseTag: 'rust-v0.153.4',
      source: 'https://github.com/openai/codex',
      sha256: 'fixture',
      managedKeys: ['model', 'model_provider', 'mcp_servers', 'approval_policy'],
      schemaJson: JSON.stringify({
        type: 'object',
        additionalProperties: false,
        definitions: {
          WebSearchMode: { enum: ['disabled', 'cached', 'indexed', 'live'] },
          Verbosity: { enum: ['low', 'medium', 'high'] },
        },
        properties: {
          web_search: { $ref: '#/definitions/WebSearchMode' },
          model_verbosity: { $ref: '#/definitions/Verbosity' },
          service_tier: { type: 'string' },
          features: {
            type: 'object',
            additionalProperties: false,
            properties: {
              browser_use: { type: 'boolean' },
              multi_agent: { type: 'boolean' },
              shell_tool: { type: 'boolean' },
            },
          },
        },
      }),
    },
    onSave: fn(async () => undefined),
  },
} satisfies Meta<typeof CodexConfigView>

export default meta
type Story = StoryObj<typeof meta>
export const Inherited: Story = {}
export const Overrides: Story = {
  args: {
    initialValue: JSON.stringify({ web_search: 'live', features: { multi_agent: false } }, null, 2),
  },
}
export const InvalidJson: Story = { args: { initialValue: '{' } }
export const SaveFailure: Story = {
  args: {
    onSave: fn(async () => {
      throw new Error('codex: unknown setting')
    }),
  },
}
export const Disabled: Story = { args: { disabled: true } }
