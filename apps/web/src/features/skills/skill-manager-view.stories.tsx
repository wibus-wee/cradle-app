import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import {
  skillInventoryFixtures,
  workspaceSkillDocumentFixture,
  workspaceSkillFixture,
} from './fixtures/skills'
import { SkillDetailView } from './skill-detail-view'
import { SkillManagerView } from './skill-manager-view'

const detail = (
  <SkillDetailView
    entry={workspaceSkillFixture}
    document={workspaceSkillDocumentFixture}
    editableScope="workspace"
    onEdit={fn()}
    onExport={fn()}
    onDelete={fn()}
  />
)

const meta = {
  title: 'Skills/Manager',
  component: SkillManagerView,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-8">
        <Story />
      </main>
    ),
  ],
  args: {
    pageTestId: 'storybook-skill-manager',
    title: 'Workspace skills',
    description: 'Skills available to agents working in this workspace.',
    editableScope: 'workspace',
    skillsReady: true,
    isLoading: false,
    errorText: null,
    searchQuery: '',
    scopeFilter: 'all',
    scopes: ['workspace', 'legacy', 'builtin'],
    inventory: skillInventoryFixtures,
    detailOpen: false,
    detail,
    onImport: fn(),
    onNew: fn(),
    onSearchQueryChange: fn(),
    onScopeFilterChange: fn(),
    onOpenDetail: fn(),
    onDelete: fn(),
    onDetailOpenChange: fn(),
  },
} satisfies Meta<typeof SkillManagerView>

export default meta

type Story = StoryObj<typeof meta>

export const Inventory: Story = {}

export const DetailOpen: Story = {
  args: {
    detailOpen: true,
  },
}

export const Loading: Story = {
  args: {
    isLoading: true,
    skillsReady: false,
    inventory: [],
  },
}

export const SearchEmpty: Story = {
  args: {
    searchQuery: 'missing-skill',
    inventory: [],
  },
}

export const LoadError: Story = {
  args: {
    errorText: 'Skills could not be loaded from the workspace.',
    inventory: [],
  },
}
