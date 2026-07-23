import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { workspaceSkillDocumentFixture } from './fixtures/skills'
import { SkillEditDialogView } from './skill-edit-dialog-view'

const meta = {
  title: 'Skills/Edit Dialog',
  component: SkillEditDialogView,
  args: {
    open: true,
    entry: {
      scope: 'workspace',
      name: workspaceSkillDocumentFixture.name,
    },
    editableScope: 'workspace',
    document: workspaceSkillDocumentFixture,
    saving: false,
    onOpenChange: fn(),
    onSave: fn(async () => {}),
  },
} satisfies Meta<typeof SkillEditDialogView>

export default meta

type Story = StoryObj<typeof meta>

export const EditWorkspaceSkill: Story = {}

export const CreateSkill: Story = {
  args: {
    entry: {
      scope: 'workspace',
      name: '__draft__',
    },
    document: null,
  },
}

export const ReadOnlyBuiltInSkill: Story = {
  args: {
    entry: {
      scope: 'builtin',
      name: 'cradle-cli',
    },
  },
}

export const Saving: Story = {
  args: {
    saving: true,
  },
}
