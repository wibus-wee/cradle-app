import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import {
  builtinSkillFixture,
  workspaceSkillDocumentFixture,
  workspaceSkillFixture,
} from './fixtures/skills'
import { SkillDetailView } from './skill-detail-view'

const meta = {
  title: 'Skills/Detail',
  component: SkillDetailView,
  decorators: [
    Story => (
      <main className="mx-auto w-full max-w-xl p-6">
        <Story />
      </main>
    ),
  ],
  args: {
    entry: workspaceSkillFixture,
    document: workspaceSkillDocumentFixture,
    editableScope: 'workspace',
    onEdit: fn(),
    onExport: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof SkillDetailView>

export default meta

type Story = StoryObj<typeof meta>

export const EditableWorkspaceSkill: Story = {}

export const ReadOnlyBuiltInSkill: Story = {
  args: {
    entry: builtinSkillFixture,
    document: {
      ...workspaceSkillDocumentFixture,
      ...builtinSkillFixture,
      frontmatter: {
        name: builtinSkillFixture.name,
        description: builtinSkillFixture.description,
      },
    },
  },
}
