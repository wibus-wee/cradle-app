import {
  DeleteLine as Trash2Icon,
  DownloadLine as DownloadIcon,
  GlobeLine as GlobeIcon,
  PencilLine as PencilIcon,
  PlusLine as PlusIcon,
  RobotLine as BotIcon,
  SearchLine as SearchIcon,
  TreeLine as FolderTreeIcon,
  UploadLine as UploadIcon,
} from '@mingcute/react'
import { useEffect, useReducer } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { ScrollArea } from '~/components/ui/scroll-area'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import { TruncatedText } from '~/components/ui/truncated-text'
import { useDirectoryPicker } from '~/features/filesystem/directory-picker-provider'
import type { SkillInventoryEntry, SkillScope } from '~/features/skills/types'
import { cn } from '~/lib/cn'

import { SettingsDivider, SettingsSectionHeader } from '../settings/settings-row'
import { SkillImportDialog } from './skill-import-dialog'
import { useSkillDocument, useSkills } from './use-skills'

interface SkillManagerProps {
  workspaceId?: string | null
  agentId?: string | null
  editableScope: EditableSkillScope
  pageTestId: string
  title: string
  description: string
}

type EditableSkillScope = 'workspace' | 'agent'

interface SelectedSkillRef {
  scope: SkillScope
  name: string
}

const FILTER_ORDER: Record<EditableSkillScope, SkillScope[]> = {
  workspace: ['workspace', 'legacy', 'builtin'],
  agent: ['agent', 'legacy', 'builtin'],
}

const VISIBLE_SCOPE_ORDER: Record<EditableSkillScope, SkillScope[]> = {
  workspace: ['workspace', 'repository', 'legacy', 'builtin'],
  agent: ['agent', 'legacy', 'builtin'],
}

const GROUP_LABELS: Record<SkillScope, string> = {
  builtin: 'Built-in',
  legacy: 'Standard',
  global: 'Global',
  repository: 'Workspace',
  workspace: 'Workspace',
  agent: 'Agent',
}

const SCOPE_ICONS: Record<SkillScope, typeof BotIcon> = {
  builtin: BotIcon,
  legacy: GlobeIcon,
  global: GlobeIcon,
  repository: FolderTreeIcon,
  workspace: FolderTreeIcon,
  agent: BotIcon,
}

const SCOPE_ACCENT: Record<SkillScope, string> = {
  builtin: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  legacy: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  global: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  repository: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  workspace: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  agent: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
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

function selectVisibleInventory(inventory: SkillInventoryEntry[], visibleScopes: ReadonlySet<SkillScope>) {
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

const EMPTY_BODY = '# Overview\n\nDescribe when the agent should use this skill.\n'

interface SkillEditState {
  nameVal: string
  descVal: string
  bodyVal: string
  extraFm: Record<string, unknown>
  error: string | null
}

type SkillEditAction
  = { type: 'reset-draft' }
    | { type: 'hydrate', payload: { name: string, description: string, body: string, frontmatter: Record<string, unknown> } }
    | { type: 'set-name', value: string }
    | { type: 'set-description', value: string }
    | { type: 'set-body', value: string }
    | { type: 'set-error', value: string | null }

const initialSkillEditState: SkillEditState = {
  nameVal: '',
  descVal: '',
  bodyVal: EMPTY_BODY,
  extraFm: {},
  error: null,
}

function skillEditReducer(state: SkillEditState, action: SkillEditAction): SkillEditState {
  switch (action.type) {
    case 'reset-draft':
      return initialSkillEditState
    case 'hydrate': {
      const { name: _n, description: _d, ...rest } = action.payload.frontmatter
      return {
        nameVal: action.payload.name,
        descVal: action.payload.description,
        bodyVal: action.payload.body,
        extraFm: rest,
        error: null,
      }
    }
    case 'set-name':
      return { ...state, nameVal: action.value }
    case 'set-description':
      return { ...state, descVal: action.value }
    case 'set-body':
      return { ...state, bodyVal: action.value }
    case 'set-error':
      return { ...state, error: action.value }
    default:
      return state
  }
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

function skillManagerUiReducer(state: SkillManagerUiState, action: SkillManagerUiAction): SkillManagerUiState {
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

/* ── Edit Dialog (create / update) ─────────────────────────────────────────── */

function SkillEditDialog({
  open,
  onOpenChange,
  entry,
  workspaceId,
  editableScope,
  agentId,
  onSaved,
  createSkill,
  updateSkill,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: SelectedSkillRef | null
  workspaceId?: string | null
  agentId?: string | null
  editableScope: EditableSkillScope
  onSaved: (scope: SkillScope, name: string) => void
  createSkill: ReturnType<typeof useSkills>['createSkill']
  updateSkill: ReturnType<typeof useSkills>['updateSkill']
}) {
  const isDraft = entry?.name === '__draft__'
  const doc = useSkillDocument(
    { workspaceId, agentId },
    isDraft ? null : entry?.scope ?? null,
    isDraft ? null : entry?.name ?? null,
  )

  const readOnly = !isDraft && entry != null && entry.scope !== editableScope
  const saving = createSkill.isPending || updateSkill.isPending
  const [state, dispatch] = useReducer(skillEditReducer, initialSkillEditState)

  useEffect(() => {
    if (isDraft) {
      dispatch({ type: 'reset-draft' })
      return
    }
    if (!doc.data) {
      return
    }
    dispatch({
      type: 'hydrate',
      payload: {
        name: doc.data.name,
        description: doc.data.description,
        body: doc.data.body,
        frontmatter: doc.data.frontmatter,
      },
    })
  }, [doc.data, isDraft])

  const handleSave = async () => {
    try {
      dispatch({ type: 'set-error', value: null })
      if (!state.nameVal.trim()) {
        throw new Error('Name is required')
      }
      if (!state.descVal.trim()) {
        throw new Error('Description is required')
      }

      const frontmatter = { name: state.nameVal.trim(), description: state.descVal.trim(), ...state.extraFm }

      if (isDraft) {
        const created = await createSkill.mutateAsync({
          scope: editableScope,
          name: state.nameVal.trim(),
          description: state.descVal.trim(),
          body: state.bodyVal,
          frontmatter,
        })
        onSaved(created.scope, created.name)
        onOpenChange(false)
        return
      }

      if (!entry) {
        throw new Error('No skill selected')
      }

      const updated = await updateSkill.mutateAsync({
        scope: entry.scope,
        currentName: entry.name,
        name: state.nameVal.trim(),
        description: state.descVal.trim(),
        body: state.bodyVal,
        frontmatter,
      })
      onSaved(updated.scope, updated.name)
      onOpenChange(false)
    }
    catch (err) {
      dispatch({ type: 'set-error', value: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>{isDraft ? 'Create Skill' : readOnly ? 'View Skill' : 'Edit Skill'}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? 'This skill is read-only from the current scope.'
              : isDraft
                ? 'Define a new skill with a name and description.'
                : 'Update the skill metadata and body content.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="skill-edit-name">Name</Label>
            <Input
              id="skill-edit-name"
              value={state.nameVal}
              onChange={e => dispatch({ type: 'set-name', value: e.target.value })}
              readOnly={readOnly}
              placeholder="my-skill"
              className="text-xs"
              data-testid="skill-name-input"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-edit-desc">Description</Label>
            <Input
              id="skill-edit-desc"
              value={state.descVal}
              onChange={e => dispatch({ type: 'set-description', value: e.target.value })}
              readOnly={readOnly}
              placeholder="What does this skill teach the agent?"
              className="text-xs"
              data-testid="skill-desc-input"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="skill-edit-body">Body</Label>
            <Textarea
              id="skill-edit-body"
              value={state.bodyVal}
              onChange={e => dispatch({ type: 'set-body', value: e.target.value })}
              readOnly={readOnly}
              spellCheck={false}
              rows={8}
              className="min-h-32 font-mono text-xs"
              data-testid="skill-body-editor"
            />
          </div>
          {state.error && (
            <p className="text-[11px] text-destructive">{state.error}</p>
          )}
        </div>

        {!readOnly && (
          <DialogFooter variant="bare">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving} data-testid="skill-save-btn">
              {saving && <Spinner className="size-3.5" />}
              {isDraft ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── Detail Pane (right side) ──────────────────────────────────────────────── */

function SkillDetail({
  entry,
  workspaceId,
  agentId,
  editableScope,
  onEdit,
  onExport,
  onDelete,
}: {
  entry: SkillInventoryEntry
  workspaceId?: string | null
  agentId?: string | null
  editableScope: EditableSkillScope
  onEdit: () => void
  onExport: () => void
  onDelete: () => void
}) {
  const doc = useSkillDocument({ workspaceId, agentId }, entry.scope, entry.name)
  const isEditable = entry.scope === editableScope
  const Icon = SCOPE_ICONS[entry.scope]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg',
              SCOPE_ACCENT[entry.scope],
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-foreground truncate">{entry.name}</h3>
            <span className="text-[11px] text-muted-foreground">{GROUP_LABELS[entry.scope]}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isEditable && (
            <Button variant="ghost" size="icon-xs" onClick={onEdit} className="text-muted-foreground hover:text-foreground" aria-label={`Edit ${entry.name}`} data-testid="skill-edit-btn">
              <PencilIcon aria-hidden="true" />
            </Button>
          )}
          <Button variant="ghost" size="icon-xs" onClick={onExport} className="text-muted-foreground hover:text-foreground" aria-label={`Export ${entry.name}`} data-testid="skill-export-btn">
            <DownloadIcon aria-hidden="true" />
          </Button>
          {isEditable && (
            <Button variant="ghost" size="icon-xs" onClick={onDelete} className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${entry.name}`} data-testid="skill-delete-btn">
              <Trash2Icon aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {entry.description && (
        <TruncatedText maxLines={3} className="text-xs text-muted-foreground/60">
          {entry.description}
        </TruncatedText>
      )}

      {doc.data?.body && (
        <div>
          <span className="text-[10px] text-muted-foreground">Content</span>
          <ScrollArea className="mt-1.5 max-h-96">
            <pre className="text-[11px] leading-relaxed text-muted-foreground/60 whitespace-pre-wrap font-mono">
              {doc.data.body}
            </pre>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

/* ── Main Component ────────────────────────────────────────────────────────── */

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

  const visibleScopes = new Set(VISIBLE_SCOPE_ORDER[editableScope])
  const visibleInventory = selectVisibleInventory(inventory, visibleScopes)
  const scopes = FILTER_ORDER[editableScope]

  const filteredInventory = (() => {
    let entries = visibleInventory
    if (uiState.scopeFilter !== 'all') {
      entries = entries.filter(e => matchesScopeFilter(e.scope, uiState.scopeFilter))
    }
    if (uiState.searchQuery.trim()) {
      const q = uiState.searchQuery.toLowerCase()
      entries = entries.filter(e =>
        e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q))
    }
    return entries.toSorted((a, b) => {
      const aDist = a.scope === editableScope ? -1 : SORT_ORDER[a.scope]
      const bDist = b.scope === editableScope ? -1 : SORT_ORDER[b.scope]
      if (aDist !== bDist) {
        return aDist - bDist
      }
      return a.name.localeCompare(b.name)
    })
  })()

  const selectedEntry = (() => {
    const selectedSkill = uiState.selectedSkill
    if (!selectedSkill) {
      return null
    }
    return visibleInventory.find(e => e.scope === selectedSkill.scope && e.name === selectedSkill.name) ?? null
  })()

  const beginDraft = () => {
    dispatch({ type: 'open-draft', scope: editableScope })
  }

  const handleSaved = (scope: SkillScope, name: string) => {
    dispatch({ type: 'skill-saved', value: { scope, name } })
  }

  const handleDelete = async () => {
    if (!selectedEntry || selectedEntry.scope !== editableScope) {
      return
    }
    await deleteSkill.mutateAsync({ scope: selectedEntry.scope, name: selectedEntry.name })
    dispatch({ type: 'set-selected-skill', value: null })
  }

  const handleImport = async () => {
    dispatch({ type: 'open-import', value: true })
  }

  const handleExport = async () => {
    if (!selectedEntry) {
      return
    }
    const destinationDir = await selectDirectory({ title: t('export.title'), description: t('export.selectDirectory') })
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
      dispatch({ type: 'set-error', value: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div
      className="flex flex-col gap-1"
      data-testid={pageTestId}
      data-workspace-skills-ready={editableScope === 'workspace' && skillsReady ? 'true' : 'false'}
    >
      {/* Header */}
      <SettingsSectionHeader
        title={title}
        description={description}
        className="pt-3"
        action={(
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => void handleImport()} data-testid="skill-import-btn" className="text-muted-foreground hover:text-foreground">
              <UploadIcon className="size-3.5" />
              Import
            </Button>
            <Button size="sm" onClick={beginDraft} data-testid="new-skill-btn">
              <PlusIcon className="size-3.5" />
              New
            </Button>
          </div>
        )}
      />

      <SettingsDivider />

      {/* Error */}
      {uiState.errorText && (
        <p className="text-[11px] text-destructive">{uiState.errorText}</p>
      )}

      {/* Search + filter row */}
      <div className="flex items-center gap-3 py-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 !text-muted-foreground/50" />
          <input
            type="text"
            aria-label="Search skills"
            value={uiState.searchQuery}
            onChange={e => dispatch({ type: 'set-search-query', value: e.target.value })}
            placeholder="Search skills..."
            className="w-full rounded-md bg-foreground/4 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none"
          />
        </div>
        <div className="flex items-center gap-0.5">
          {(['all' as const, ...scopes] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => dispatch({ type: 'set-scope-filter', value: s })}
              className={cn(
                'px-2 py-1 text-[11px] font-medium rounded-md transition-colors',
                uiState.scopeFilter === s
                  ? 'bg-foreground/8 text-foreground'
                  : 'text-muted-foreground/50 hover:text-muted-foreground',
              )}
            >
              {s === 'all' ? 'All' : GROUP_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Skill list */}
      {isLoading
        ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        )
        : filteredInventory.length === 0
          ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              {uiState.searchQuery.trim() ? 'No matching skills' : 'No skills yet'}
            </div>
          )
          : (
            <div className="flex flex-col divide-y divide-foreground/5">
              {filteredInventory.map((entry) => {
                const Icon = SCOPE_ICONS[entry.scope]
                const isEditable = entry.scope === editableScope
                return (
                  <div
                    key={`${entry.scope}:${entry.name}`}
                    className="group flex items-center gap-2 transition-colors hover:bg-foreground/3 -mx-2 px-2 rounded-md"
                  >
                    <button
                      type="button"
                      aria-label={`Open ${entry.name} details`}
                      onClick={() => {
                        dispatch({ type: 'set-selected-skill', value: { scope: entry.scope, name: entry.name } })
                        dispatch({ type: 'open-detail', value: true })
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                    >
                      <span
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-lg',
                          SCOPE_ACCENT[entry.scope],
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-foreground truncate">
                          {entry.name}
                        </span>
                        <TruncatedText maxLines={1} className="text-[11px] text-muted-foreground/60">
                          {entry.description}
                        </TruncatedText>
                      </span>
                      <span className="text-[10px] text-muted-foreground/40">
                        {GROUP_LABELS[entry.scope]}
                      </span>
                    </button>
                    {isEditable && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="opacity-0 shrink-0 text-muted-foreground/40 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Delete ${entry.name} from list`}
                        onClick={() => {
                          void deleteSkill.mutateAsync({ scope: entry.scope, name: entry.name })
                        }}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

      {/* Detail Dialog */}
      <Dialog open={uiState.detailOpen} onOpenChange={open => dispatch({ type: 'open-detail', value: open })}>
        <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto" showCloseButton>
          <DialogHeader>
            <DialogTitle>Skill Detail</DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <SkillDetail
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
                void handleDelete()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <SkillImportDialog
        open={uiState.importDialogOpen}
        onOpenChange={open => dispatch({ type: 'open-import', value: open })}
        editableScope={editableScope}
        workspaceId={workspaceId}
        agentId={agentId}
      />

      {/* Edit Dialog */}
      <SkillEditDialog
        open={uiState.dialogOpen}
        onOpenChange={open => dispatch({ type: 'open-dialog', value: open })}
        entry={uiState.editingSkill}
        workspaceId={workspaceId}
        editableScope={editableScope}
        agentId={agentId}
        onSaved={handleSaved}
        createSkill={createSkill}
        updateSkill={updateSkill}
      />
    </div>
  )
}
