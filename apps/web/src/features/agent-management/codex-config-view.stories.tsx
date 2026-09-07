import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { CodexConfigView } from './codex-config-view'

const FIXTURE_MANAGED_KEYS = [
  'model',
  'model_provider',
  'mcp_servers',
  'approval_policy',
  'sandbox_mode',
  'permissions',
  'instructions',
]

export const fixtureSchema = {
  version: '0.153.4',
  releaseTag: 'rust-v0.153.4',
  source: 'https://github.com/openai/codex',
  sha256: 'fixture',
  managedKeys: FIXTURE_MANAGED_KEYS,
  schemaJson: JSON.stringify({
    type: 'object',
    additionalProperties: false,
    definitions: {
      WebSearchMode: {
        type: 'string',
        enum: ['disabled', 'cached', 'indexed', 'live'],
      },
      Verbosity: {
        type: 'string',
        description: 'Controls output length/detail on GPT-5 models via the Responses API.',
        enum: ['low', 'medium', 'high'],
      },
      AbsolutePathBuf: {
        type: 'string',
        description: 'An absolute path.',
      },
      Tui: {
        type: 'object',
        additionalProperties: false,
        properties: {
          alternate_screen: {
            description: 'Use the alternate screen while the TUI is running.',
            allOf: [{ $ref: '#/definitions/AlternateScreenMode' }],
          },
          animations: {
            type: 'boolean',
            description: 'Enable terminal animations (welcome screen, spinner, shimmer, etc.).',
            default: true,
          },
          status_line: {
            type: 'array',
            description: 'Ordered items shown in the status line.',
            items: { type: 'string' },
          },
        },
      },
      AlternateScreenMode: {
        type: 'string',
        enum: ['auto', 'always', 'never'],
      },
      History: {
        type: 'object',
        additionalProperties: false,
        properties: {
          persistence: {
            description: 'How history is persisted to disk.',
            allOf: [{ $ref: '#/definitions/HistoryPersistence' }],
          },
          max_bytes: {
            type: 'integer',
            description: 'Maximum size of the history file in bytes; oldest entries are dropped.',
          },
        },
      },
      HistoryPersistence: {
        type: 'string',
        enum: ['save-all', 'none'],
      },
    },
    properties: {
      web_search: {
        description: 'Controls the web search tool mode: disabled, cached, indexed, or live.',
        allOf: [{ $ref: '#/definitions/WebSearchMode' }],
      },
      model_verbosity: {
        description: 'Optional verbosity control for GPT-5 models (Responses API `text.verbosity`).',
        allOf: [{ $ref: '#/definitions/Verbosity' }],
      },
      service_tier: {
        type: 'string',
        description: 'Optional explicit service tier request id for new turns.',
      },
      hide_agent_reasoning: {
        type: 'boolean',
        description: 'When `true`, `AgentReasoning` events will be hidden from the UI/output.',
      },
      check_for_update_on_startup: {
        type: 'boolean',
        description: 'When `true`, checks for Codex updates on startup and surfaces update prompts.',
        default: true,
      },
      compact_prompt: {
        type: 'string',
        description: 'Compact prompt used for history compaction.',
      },
      model_context_window: {
        type: 'integer',
        description: 'Size of the context window for the model, in tokens.',
      },
      tui: {
        description: 'Collection of settings that are specific to the TUI.',
        allOf: [{ $ref: '#/definitions/Tui' }],
      },
      history: {
        description: 'Settings that govern if and what will be written to `~/.codex/history.jsonl`.',
        allOf: [{ $ref: '#/definitions/History' }],
      },
      notify: {
        type: 'array',
        description: 'Optional external command to spawn for end-user notifications.',
        items: { type: 'string' },
      },
      features: {
        type: 'object',
        description: 'Centralized feature flags (new). Prefer this over individual toggles.',
        additionalProperties: false,
        properties: {
          apply_patch_freeform: { type: 'boolean' },
          auth_elicitation: { type: 'boolean' },
          browser_use: { type: 'boolean' },
          multi_agent: { type: 'boolean' },
          shell_tool: { type: 'boolean' },
          apps_mcp_path_override: { allOf: [{ $ref: '#/definitions/AbsolutePathBuf' }] },
        },
      },
    },
  }),
}

const meta = {
  title: 'Agent Management/CodexConfigView',
  component: CodexConfigView,
  decorators: [
    Story => (
      <div className="min-h-screen bg-muted/20 p-10 text-foreground">
        <div className="mx-auto max-w-2xl">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    initialValue: '{}',
    schema: fixtureSchema,
    onSave: fn(async () => undefined),
  },
} satisfies Meta<typeof CodexConfigView>

export default meta
type Story = StoryObj<typeof meta>

export const Inherited: Story = {}

export const Overrides: Story = {
  args: {
    initialValue: JSON.stringify(
      {
        web_search: 'live',
        model_context_window: 272000,
        tui: { alternate_screen: 'never', status_line: ['model-name', 'git-branch'] },
        notify: ['terminal-notifier', '-title', 'Codex'],
        features: { multi_agent: false, browser_use: true },
      },
      null,
      2,
    ),
  },
}

export const SearchResults: Story = {
  args: {
    initialValue: JSON.stringify({ hide_agent_reasoning: true }, null, 2),
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
