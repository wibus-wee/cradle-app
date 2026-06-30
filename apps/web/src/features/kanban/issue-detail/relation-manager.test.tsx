import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { KanbanIssue, KanbanIssueRelation } from '~/features/kanban/types'

import { RelationManager } from './relation-manager'

const mocks = vi.hoisted(() => ({
  addRelationMutate: vi.fn(),
  deleteRelationMutate: vi.fn(),
  issues: [] as KanbanIssue[],
  relations: [] as KanbanIssueRelation[],
  searchIssues: [] as KanbanIssue[],
}))

vi.mock('~/features/workspace/use-workspace', () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: 'workspace-1', identifier: 'CRA' }],
  }),
}))

vi.mock('../use-kanban', () => ({
  useAddRelation: () => ({
    isPending: false,
    mutate: mocks.addRelationMutate,
  }),
  useDeleteRelation: () => ({
    mutate: mocks.deleteRelationMutate,
  }),
  useIssues: () => ({
    data: mocks.issues,
    isLoading: false,
  }),
  useRelations: () => ({
    data: mocks.relations,
  }),
  useSearchIssues: () => ({
    data: mocks.searchIssues,
    isFetching: false,
  }),
}))

const PopoverContext = createContext<{
  open: boolean
  onOpenChange?: (open: boolean) => void
}>({ open: false })

vi.mock('~/components/ui/popover', () => ({
  Popover: ({ children, open, onOpenChange }: { children: ReactNode, open?: boolean, onOpenChange?: (open: boolean) => void }) => (
    <PopoverContext.Provider value={{ open: !!open, onOpenChange }}>
      <div>{children}</div>
    </PopoverContext.Provider>
  ),
  PopoverContent: ({ children }: { children: ReactNode }) => {
    const context = useContext(PopoverContext)
    return context.open ? <div>{children}</div> : null
  },
  PopoverTrigger: ({ children, ...props }: ComponentProps<'button'>) => (
    <PopoverContext.Consumer>
      {context => (
        <button type="button" {...props} onClick={() => context.onOpenChange?.(true)}>
          {children}
        </button>
      )}
    </PopoverContext.Consumer>
  ),
}))

type ComboboxContextValue = {
  inputValue?: string
  onInputValueChange?: (value: string) => void
  onValueChange?: (value: string | null) => void
}

const ComboboxContext = createContext<ComboboxContextValue>({})

vi.mock('~/components/ui/combobox', () => ({
  Combobox: ({ children, inputValue, onInputValueChange, onValueChange }: ComboboxContextValue & { children: ReactNode }) => (
    <ComboboxContext.Provider value={{ inputValue, onInputValueChange, onValueChange }}>
      <div>{children}</div>
    </ComboboxContext.Provider>
  ),
  ComboboxContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComboboxInput: ({ 'aria-label': ariaLabel, placeholder }: ComponentProps<'input'> & {
    showClear?: boolean
    showTrigger?: boolean
    startAddon?: ReactNode
  }) => {
    const context = useContext(ComboboxContext)

    return (
      <input
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={context.inputValue ?? ''}
        onChange={event => context.onInputValueChange?.(event.currentTarget.value)}
      />
    )
  },
  ComboboxItem: ({ children, value, disabled }: { children: ReactNode, value: string, disabled?: boolean }) => {
    const context = useContext(ComboboxContext)

    return (
      <button type="button" role="option" aria-selected={false} disabled={disabled} onClick={() => context.onValueChange?.(value)}>
        {children}
      </button>
    )
  },
  ComboboxList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('~/components/ui/skeleton', () => ({
  Skeleton: () => <div data-testid="relation-skeleton" />,
}))

afterEach(() => {
  cleanup()
})

const now = 1_700_000_000

function issue(id: string, number: number, title: string): KanbanIssue {
  return {
    id,
    workspaceId: 'workspace-1',
    number,
    statusId: null,
    milestoneId: null,
    parentIssueId: null,
    title,
    description: null,
    priority: 'none',
    labels: [],
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

function relation(id: string, sourceIssueId: string, targetIssueId: string, type: KanbanIssueRelation['type']): KanbanIssueRelation {
  return {
    id,
    sourceIssueId,
    targetIssueId,
    type,
    createdAt: now,
  }
}

function openSection(label: string) {
  fireEvent.click(screen.getByRole('button', { name: `Add ${label} relation` }))
}

describe('relation manager', () => {
  beforeEach(() => {
    mocks.addRelationMutate.mockReset()
    mocks.addRelationMutate.mockImplementation((_input, options) => options?.onSuccess?.())
    mocks.deleteRelationMutate.mockReset()
    mocks.issues = [
      issue('issue-current', 1, 'Current issue'),
      issue('issue-a', 2, 'Alpha target'),
      issue('issue-b', 3, 'Beta target'),
      issue('issue-c', 4, 'Gamma target'),
    ]
    mocks.searchIssues = []
    mocks.relations = []
  })

  it('renders semantic relation sections from the current issue perspective', () => {
    mocks.relations = [
      relation('rel-1', 'issue-current', 'issue-a', 'blocks'),
      relation('rel-2', 'issue-b', 'issue-current', 'blocks'),
      relation('rel-3', 'issue-current', 'issue-c', 'duplicates'),
      relation('rel-4', 'issue-a', 'issue-current', 'duplicates'),
      relation('rel-5', 'issue-b', 'issue-current', 'relates_to'),
    ]

    render(<RelationManager issueId="issue-current" workspaceId="workspace-1" />)

    expect(screen.getByRole('heading', { name: 'Blocks' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Blocked by' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Duplicates' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Duplicated by' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Related to' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Blocks relation CRA-2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Blocked by relation CRA-3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Duplicates relation CRA-4' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Duplicated by relation CRA-2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove Related to relation CRA-3' })).toBeTruthy()
  })

  it('adds an inverse blocks relation from the blocked by section', () => {
    render(<RelationManager issueId="issue-current" workspaceId="workspace-1" />)

    openSection('Blocked by')
    fireEvent.click(screen.getByRole('option', { name: /CRA-2.*Alpha target/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Blocked by' }))

    expect(mocks.addRelationMutate).toHaveBeenCalledWith({
      sourceIssueId: 'issue-a',
      targetIssueId: 'issue-current',
      type: 'blocks',
    }, expect.any(Object))
  })

  it('adds a relation to a pasted issue id without requiring an autocomplete match', () => {
    render(<RelationManager issueId="issue-current" workspaceId="workspace-1" />)

    openSection('Duplicates')
    fireEvent.change(screen.getByRole('textbox', { name: 'Target issue for Duplicates' }), {
      target: { value: 'external-issue-id' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Duplicates' }))

    expect(mocks.addRelationMutate).toHaveBeenCalledWith({
      sourceIssueId: 'issue-current',
      targetIssueId: 'external-issue-id',
      type: 'duplicates',
    }, expect.any(Object))
  })

  it('resolves a typed readable issue key before creating the relation', () => {
    render(<RelationManager issueId="issue-current" workspaceId="workspace-1" />)

    openSection('Blocks')
    fireEvent.change(screen.getByRole('textbox', { name: 'Target issue for Blocks' }), {
      target: { value: 'CRA-2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add to Blocks' }))

    expect(mocks.addRelationMutate).toHaveBeenCalledWith({
      sourceIssueId: 'issue-current',
      targetIssueId: 'issue-a',
      type: 'blocks',
    }, expect.any(Object))
  })

  it('adds a relates_to relation from the related to section', () => {
    render(<RelationManager issueId="issue-current" workspaceId="workspace-1" />)

    openSection('Related to')
    fireEvent.click(screen.getByRole('option', { name: /CRA-3.*Beta target/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to Related to' }))

    expect(mocks.addRelationMutate).toHaveBeenCalledWith({
      sourceIssueId: 'issue-current',
      targetIssueId: 'issue-b',
      type: 'relates_to',
    }, expect.any(Object))
  })
})
