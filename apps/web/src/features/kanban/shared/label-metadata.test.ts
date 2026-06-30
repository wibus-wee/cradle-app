import { describe, expect, it } from 'vitest'

import type { KanbanIssue } from '~/features/kanban/types'

import {
  buildDeleteLabelPatches,
  buildRenameLabelPatches,
  collectWorkspaceLabelOptions,
  filterWorkspaceLabelOptions,
} from './label-metadata'

const now = 1_700_000_000

function issue(id: string, labels: string[]): KanbanIssue {
  return {
    id,
    workspaceId: 'workspace-1',
    number: 1,
    statusId: null,
    milestoneId: null,
    parentIssueId: null,
    title: id,
    description: null,
    priority: 'none',
    labels,
    assigneeKind: null,
    assigneeId: null,
    dueDate: null,
    createdByKind: 'user',
    createdById: '__self__',
    sourceChatSessionId: null,
    delegateAgentId: null,
    delegateProviderTargetId: null,
    contextRefs: '[]',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }
}

describe('label metadata helpers', () => {
  it('collects workspace labels by normalized name and sorts by usage count', () => {
    const options = collectWorkspaceLabelOptions([
      issue('issue-a', ['Bug', 'frontend']),
      issue('issue-b', ['bug', 'api']),
      issue('issue-c', ['frontend']),
    ])

    expect(options.map(option => [option.label, option.count])).toEqual([
      ['Bug', 2],
      ['frontend', 2],
      ['api', 1],
    ])
    expect(options.every(option => option.tone)).toBe(true)
  })

  it('filters suggestions by query and excludes labels already selected on the issue', () => {
    const options = collectWorkspaceLabelOptions([
      issue('issue-a', ['frontend']),
      issue('issue-b', ['Feature']),
      issue('issue-c', ['backend']),
    ])

    const filtered = filterWorkspaceLabelOptions(options, 'fe', ['frontend'])

    expect(filtered.map(option => option.label)).toEqual(['Feature'])
  })

  it('builds per-issue rename patches and merges labels that already use the target name', () => {
    const patches = buildRenameLabelPatches([
      issue('issue-a', ['bug', 'frontend']),
      issue('issue-b', ['Bug', 'defect']),
      issue('issue-c', ['docs']),
    ], 'bug', 'defect')

    expect(patches).toEqual([
      { issueId: 'issue-a', labels: ['defect', 'frontend'] },
      { issueId: 'issue-b', labels: ['defect'] },
    ])
  })

  it('builds per-issue delete patches for matching labels only', () => {
    const patches = buildDeleteLabelPatches([
      issue('issue-a', ['bug', 'frontend']),
      issue('issue-b', ['Bug']),
      issue('issue-c', ['docs']),
    ], 'bug')

    expect(patches).toEqual([
      { issueId: 'issue-a', labels: ['frontend'] },
      { issueId: 'issue-b', labels: [] },
    ])
  })
})
