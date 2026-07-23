import { useEffect, useReducer, useRef } from 'react'

import type {
  SkillImportDialogViewState,
  SkillImportFetchResult,
  SkillImportResult,
} from './skill-import-contract'
import { SkillImportDialogView } from './skill-import-dialog-view'
import type { SkillScope } from './types'
import { useSkillSourceImport } from './use-skills'

type SkillImportDialogAction
  = { type: 'reset' }
    | { type: 'fetch-start', source: string }
    | { type: 'fetch-success', source: string, result: SkillImportFetchResult }
    | { type: 'fetch-error', error: string }
    | { type: 'toggle-skill', skillDir: string }
    | { type: 'toggle-all', skillDirs: string[] }
    | { type: 'install-start' }
    | { type: 'install-success', result: SkillImportResult }
    | { type: 'install-error', error: string }

const initialSkillImportDialogState: SkillImportDialogViewState = {
  step: 'input',
  sourceInput: '',
  fetchResult: null,
  selected: new Set<string>(),
  importResult: null,
  fetchError: null,
}

function skillImportDialogReducer(
  state: SkillImportDialogViewState,
  action: SkillImportDialogAction,
): SkillImportDialogViewState {
  switch (action.type) {
    case 'reset':
      return initialSkillImportDialogState
    case 'fetch-start':
      return {
        ...state,
        sourceInput: action.source,
        fetchError: null,
        step: 'fetching',
      }
    case 'fetch-success':
      return {
        ...state,
        sourceInput: action.source,
        fetchResult: action.result,
        selected: new Set(action.result.skills.map(skill => skill.skillDir)),
        step: 'select',
      }
    case 'fetch-error':
      return {
        ...state,
        fetchError: action.error,
        step: 'input',
      }
    case 'toggle-skill': {
      const selected = new Set(state.selected)
      if (selected.has(action.skillDir)) {
        selected.delete(action.skillDir)
      }
      else {
        selected.add(action.skillDir)
      }
      return { ...state, selected }
    }
    case 'toggle-all':
      return {
        ...state,
        selected: state.selected.size === action.skillDirs.length
          ? new Set()
          : new Set(action.skillDirs),
      }
    case 'install-start':
      return { ...state, step: 'installing' }
    case 'install-success':
      return {
        ...state,
        importResult: action.result,
        step: 'done',
      }
    case 'install-error':
      return {
        ...state,
        fetchError: action.error,
        step: 'select',
      }
    default:
      return state
  }
}

interface SkillImportDialogProps {
  open: boolean
  editableScope: SkillScope
  workspaceId?: string | null
  agentId?: string | null
  onOpenChange: (open: boolean) => void
}

export function SkillImportDialog({
  open,
  onOpenChange,
  editableScope,
  workspaceId,
  agentId,
}: SkillImportDialogProps) {
  const { fetchSource, importFromFetch, cancelFetch } = useSkillSourceImport({
    workspaceId,
    agentId,
  })
  const [state, dispatch] = useReducer(
    skillImportDialogReducer,
    initialSkillImportDialogState,
  )
  const previousOpenRef = useRef(open)

  useEffect(() => {
    if (open && !previousOpenRef.current) {
      dispatch({ type: 'reset' })
    }
    previousOpenRef.current = open
  }, [open])

  const handleClose = () => {
    if (state.fetchResult?.sessionId && state.step !== 'done') {
      cancelFetch.mutate(state.fetchResult.sessionId)
    }
    onOpenChange(false)
  }

  const handleFetch = async (source: string) => {
    dispatch({ type: 'fetch-start', source })
    try {
      const result = await fetchSource.mutateAsync(source)
      dispatch({
        type: 'fetch-success',
        source,
        result: {
          sessionId: result.sessionId,
          sourceLabel: result.source.label,
          sourceType: result.source.type,
          skills: result.skills,
        },
      })
    }
    catch (error) {
      dispatch({
        type: 'fetch-error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleToggleAll = () => {
    if (state.fetchResult) {
      dispatch({
        type: 'toggle-all',
        skillDirs: state.fetchResult.skills.map(skill => skill.skillDir),
      })
    }
  }

  const handleInstall = async () => {
    if (!state.fetchResult || state.selected.size === 0) {
      return
    }
    dispatch({ type: 'install-start' })
    try {
      const result = await importFromFetch.mutateAsync({
        sessionId: state.fetchResult.sessionId,
        selectedDirs: Array.from(state.selected),
        scope: editableScope,
        overwrite: false,
      })
      dispatch({
        type: 'install-success',
        result: {
          imported: result.imported.length,
          errors: result.errors,
        },
      })
    }
    catch (error) {
      dispatch({
        type: 'install-error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <SkillImportDialogView
      open={open}
      editableScope={editableScope}
      state={state}
      isFetching={fetchSource.isPending}
      onOpenChange={onOpenChange}
      onClose={handleClose}
      onFetch={source => void handleFetch(source)}
      onToggle={skillDir => dispatch({ type: 'toggle-skill', skillDir })}
      onToggleAll={handleToggleAll}
      onInstall={() => void handleInstall()}
    />
  )
}
