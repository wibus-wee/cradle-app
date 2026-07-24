import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { discoveredSkillFixtures } from './fixtures/skills'
import type { SkillImportDialogViewState } from './skill-import-contract'
import { SkillImportDialogView } from './skill-import-dialog-view'

const fetchResult = {
  sessionId: 'skill-fetch-fixture',
  sourceLabel: 'Cradle skills',
  sourceType: 'github',
  skills: discoveredSkillFixtures,
}

const inputState = {
  step: 'input',
  sourceInput: '',
  fetchResult: null,
  selected: new Set<string>(),
  importResult: null,
  fetchError: null,
} satisfies SkillImportDialogViewState

const selectState = {
  step: 'select',
  sourceInput: 'https://github.com/cradle-app/skills',
  fetchResult,
  selected: new Set(discoveredSkillFixtures.map(skill => skill.skillDir)),
  importResult: null,
  fetchError: null,
} satisfies SkillImportDialogViewState

const meta = {
  title: 'Skills/Import Dialog',
  component: SkillImportDialogView,
  args: {
    open: true,
    editableScope: 'workspace',
    state: inputState,
    isFetching: false,
    onOpenChange: fn(),
    onClose: fn(),
    onFetch: fn(),
    onToggle: fn(),
    onToggleAll: fn(),
    onInstall: fn(),
  },
} satisfies Meta<typeof SkillImportDialogView>

export default meta

type Story = StoryObj<typeof meta>

export const SourceInput: Story = {}

export const SourceError: Story = {
  args: {
    state: {
      ...inputState,
      fetchError: 'The repository could not be reached. Check the source URL and retry.',
    },
  },
}

export const Fetching: Story = {
  args: {
    state: {
      ...inputState,
      step: 'fetching',
      sourceInput: 'https://github.com/cradle-app/skills',
    },
    isFetching: true,
  },
}

export const SelectSkills: Story = {
  args: {
    state: selectState,
  },
}

export const Installing: Story = {
  args: {
    state: {
      ...selectState,
      step: 'installing',
    },
  },
}

export const DoneWithPartialFailure: Story = {
  args: {
    state: {
      ...selectState,
      step: 'done',
      importResult: {
        imported: 2,
        errors: [
          {
            dir: '/tmp/skill-source/incident-triage',
            error: 'A skill with this name already exists in the workspace scope.',
          },
        ],
      },
    },
  },
}
