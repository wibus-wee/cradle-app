import { useReducer } from 'react'
import { useTranslation } from 'react-i18next'

import { useDirectoryPicker } from '~/features/filesystem/directory-picker-provider'

import { SkillDetailContainer } from './skill-detail-container'
import { SkillEditDialogContainer } from './skill-edit-dialog-container'
import { SkillImportDialog } from './skill-import-dialog'
import type {
  EditableSkillScope,
  SelectedSkillRef,
} from './skill-manager-contract'
import { SkillManagerView } from './skill-manager-view'
import type { SkillInventoryEntry, SkillScope } from './types'
import { useSkills } from './use-skills'

interface SkillManagerProps {
  workspaceId?: string | null
  agentId?: string | null
  editableScope: EditableSkillScope
  pageTestId: string
  title: string
  description: string
}

const FILTER_ORDER: Record<EditableSkillScope, SkillScope[]> = {
  workspace: ['workspace', 'legacy', 'builtin'],
  agent: ['agent', 'legacy', 'builtin'],
}

const VISIBLE_SCOPE_ORDER: Record<EditableSkillScope, SkillScope[]> = {
  workspace: ['workspace', 'repository', 'legacy', 'builtin'],
  agent: ['agent', 'legacy', 'builtin'],
}

const SORT_ORDER: Record<SkillScope, number> = {
  agent: 0,
  workspace: 1,
  repository: 1,
  legacy: 2,
  builtin: 3,
  global: 99,
}

const SCOPE_PRIORITY: Record<SkillScope, number> = {
  builtin: 0,
  legacy: 1,
  global: 2,
  repository: 3,
  workspace: 4,
  agent: 5,
}

function matchesScopeFilter(entryScope: SkillScope, filter: SkillScope | 'all') {
  if (filter === 'all') {
    return true
  }
  if (filter === 'workspace') {
    return entryScope === 'workspace' || entryScope === 'repository'
  }
  return entryScope === filter
}

function selectVisibleInventory(
  inventory: SkillInventoryEntry[],
  visibleScopes: ReadonlySet<SkillScope>,
) {
  const activeScopeByName = new Map<string, SkillScope>()

  for (const entry of inventory) {
    if (!visibleScopes.has(entry.scope)) {
      continue
    }
    const currentScope = activeScopeByName.get(entry.name)
    if (!currentScope || SCOPE_PRIORITY[entry.scope] >= SCOPE_PRIORITY[currentScope]) {
      activeScopeByName.set(entry.name, entry.scope)
    }
  }

  return inventory.filter(entry =>
    visibleScopes.has(entry.scope) && activeScopeByName.get(entry.name) === entry.scope)
}

interface SkillManagerUiState {
  selectedSkill: SelectedSkillRef | null
  editingSkill: SelectedSkillRef | null
  dialogOpen: boolean
  importDialogOpen: boolean
  detailOpen: boolean
  searchQuery: string
  scopeFilter: SkillScope | 'all'
  errorText: string | null
}

type SkillManagerUiAction
  = { type: 'open-draft', scope: SkillScope }
    | { type: 'set-selected-skill', value: SelectedSkillRef | null }
    | { type: 'open-detail', value: boolean }
    | { type: 'open-dialog', value: boolean }
    | { type: 'open-import', value: boolean }
    | { type: 'set-editing-skill', value: SelectedSkillRef | null }
    | { type: 'set-search-query', value: string }
    | { type: 'set-scope-filter', value: SkillScope | 'all' }
    | { type: 'set-error', value: string | null }
    | { type: 'skill-saved', value: SelectedSkillRef }

const initialSkillManagerUiState: SkillManagerUiState = {
  selectedSkill: null,
  editingSkill: null,
  dialogOpen: false,
  importDialogOpen: false,
  detailOpen: false,
  searchQuery: '',
  scopeFilter: 'all',
  errorText: null,
}

function skillManagerUiReducer(
  state: SkillManagerUiState,
  action: SkillManagerUiAction,
): SkillManagerUiState {
  switch (action.type) {
    case 'open-draft':
      return {
        ...state,
        editingSkill: { scope: action.scope, name: '__draft__' },
        dialogOpen: true,
      }
    case 'set-selected-skill':
      return { ...state, selectedSkill: action.value }
    case 'open-detail':
      return { ...state, detailOpen: action.value }
    case 'open-dialog':
      return { ...state, dialogOpen: action.value }
    case 'open-import':
      return { ...state, importDialogOpen: action.value }
    case 'set-editing-skill':
      return { ...state, editingSkill: action.value }
    case 'set-search-query':
      return { ...state, searchQuery: action.value }
    case 'set-scope-filter':
      return { ...state, scopeFilter: action.value }
    case 'set-error':
      return { ...state, errorText: action.value }
    case 'skill-saved':
      return {
        ...state,
        selectedSkill: action.value,
        editingSkill: null,
      }
    default:
      return state
  }
}

export function SkillManager({
  workspaceId,
  agentId,
  editableScope,
  pageTestId,
  title,
  description,
}: SkillManagerProps) {
  const { t } = useTranslation('skills')
  const {
    inventory,
    isLoading,
    isSuccess: skillsReady,
    createSkill,
    updateSkill,
    deleteSkill,
    exportSkill,
  } = useSkills({ workspaceId, agentId })
  const { selectDirectory } = useDirectoryPicker()
  const [uiState, dispatch] = useReducer(skillManagerUiReducer, initialSkillManagerUiState)

  const visibleInventory = selectVisibleInventory(
    inventory,
    new Set(VISIBLE_SCOPE_ORDER[editableScope]),
  )
  const filteredInventory = visibleInventory
    .filter(entry => matchesScopeFilter(entry.scope, uiState.scopeFilter))
    .filter((entry) => {
      const query = uiState.searchQuery.trim().toLowerCase()
      return !query
        || entry.name.toLowerCase().includes(query)
        || entry.description.toLowerCase().includes(query)
    })
    .toSorted((left, right) => {
      const leftDistance = left.scope === editableScope ? -1 : SORT_ORDER[left.scope]
      const rightDistance = right.scope === editableScope ? -1 : SORT_ORDER[right.scope]
      return leftDistance === rightDistance
        ? left.name.localeCompare(right.name)
        : leftDistance - rightDistance
    })

  const selectedEntry = uiState.selectedSkill
    ? visibleInventory.find(entry =>
        entry.scope === uiState.selectedSkill?.scope
        && entry.name === uiState.selectedSkill.name) ?? null
    : null

  const handleDelete = async (entry: SkillInventoryEntry) => {
    if (entry.scope !== editableScope) {
      return
    }
    await deleteSkill.mutateAsync({ scope: entry.scope, name: entry.name })
    if (
      uiState.selectedSkill?.scope === entry.scope
      && uiState.selectedSkill.name === entry.name
    ) {
      dispatch({ type: 'set-selected-skill', value: null })
    }
  }

  const handleExport = async () => {
    if (!selectedEntry) {
      return
    }
    const destinationDir = await selectDirectory({
      title: t('export.title'),
      description: t('export.selectDirectory'),
    })
    if (!destinationDir) {
      return
    }
    try {
      dispatch({ type: 'set-error', value: null })
      await exportSkill.mutateAsync({
        scope: selectedEntry.scope,
        name: selectedEntry.name,
        destinationDir,
      })
    }
    catch (error) {
      dispatch({
        type: 'set-error',
        value: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const detail = selectedEntry
    ? (
        <SkillDetailContainer
          entry={selectedEntry}
          workspaceId={workspaceId}
          editableScope={editableScope}
          agentId={agentId}
          onEdit={() => {
            dispatch({ type: 'open-detail', value: false })
            dispatch({ type: 'set-editing-skill', value: uiState.selectedSkill })
            dispatch({ type: 'open-dialog', value: true })
          }}
          onExport={() => {
            dispatch({ type: 'open-detail', value: false })
            void handleExport()
          }}
          onDelete={() => {
            dispatch({ type: 'open-detail', value: false })
            void handleDelete(selectedEntry)
          }}
        />
      )
    : null

  return (
    <>
      <SkillManagerView
        pageTestId={pageTestId}
        title={title}
        description={description}
        editableScope={editableScope}
        skillsReady={skillsReady}
        isLoading={isLoading}
        errorText={uiState.errorText}
        searchQuery={uiState.searchQuery}
        scopeFilter={uiState.scopeFilter}
        scopes={FILTER_ORDER[editableScope]}
        inventory={filteredInventory}
        detailOpen={uiState.detailOpen}
        detail={detail}
        onImport={() => dispatch({ type: 'open-import', value: true })}
        onNew={() => dispatch({ type: 'open-draft', scope: editableScope })}
        onSearchQueryChange={query =>
          dispatch({ type: 'set-search-query', value: query })}
        onScopeFilterChange={scope =>
          dispatch({ type: 'set-scope-filter', value: scope })}
        onOpenDetail={(entry) => {
          dispatch({
            type: 'set-selected-skill',
            value: { scope: entry.scope, name: entry.name },
          })
          dispatch({ type: 'open-detail', value: true })
        }}
        onDelete={entry => void handleDelete(entry)}
        onDetailOpenChange={open => dispatch({ type: 'open-detail', value: open })}
      />

      <SkillImportDialog
        open={uiState.importDialogOpen}
        onOpenChange={open => dispatch({ type: 'open-import', value: open })}
        editableScope={editableScope}
        workspaceId={workspaceId}
        agentId={agentId}
      />

      <SkillEditDialogContainer
        open={uiState.dialogOpen}
        onOpenChange={open => dispatch({ type: 'open-dialog', value: open })}
        entry={uiState.editingSkill}
        workspaceId={workspaceId}
        editableScope={editableScope}
        agentId={agentId}
        onSaved={(scope, name) =>
          dispatch({ type: 'skill-saved', value: { scope, name } })}
        createSkill={createSkill}
        updateSkill={updateSkill}
      />
    </>
  )
}
