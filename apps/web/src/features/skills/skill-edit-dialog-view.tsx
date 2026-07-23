import { useEffect, useReducer } from 'react'

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
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'

import type { EditableSkillScope, SelectedSkillRef } from './skill-manager-contract'
import type { SkillDocument } from './types'

const EMPTY_BODY = '# Overview\n\nDescribe when the agent should use this skill.\n'

interface SkillEditState {
  name: string
  description: string
  body: string
  frontmatter: Record<string, unknown>
  error: string | null
}

type SkillEditAction
  = { type: 'reset-draft' }
    | { type: 'hydrate', document: SkillDocument }
    | { type: 'set-name', value: string }
    | { type: 'set-description', value: string }
    | { type: 'set-body', value: string }
    | { type: 'set-error', value: string | null }

const initialSkillEditState: SkillEditState = {
  name: '',
  description: '',
  body: EMPTY_BODY,
  frontmatter: {},
  error: null,
}

function skillEditReducer(state: SkillEditState, action: SkillEditAction): SkillEditState {
  switch (action.type) {
    case 'reset-draft':
      return initialSkillEditState
    case 'hydrate': {
      const { name: _name, description: _description, ...frontmatter }
        = action.document.frontmatter
      return {
        name: action.document.name,
        description: action.document.description,
        body: action.document.body,
        frontmatter,
        error: null,
      }
    }
    case 'set-name':
      return { ...state, name: action.value }
    case 'set-description':
      return { ...state, description: action.value }
    case 'set-body':
      return { ...state, body: action.value }
    case 'set-error':
      return { ...state, error: action.value }
    default:
      return state
  }
}

export interface SkillEditSubmission {
  name: string
  description: string
  body: string
  frontmatter: Record<string, unknown>
}

interface SkillEditDialogViewProps {
  open: boolean
  entry: SelectedSkillRef | null
  editableScope: EditableSkillScope
  document: SkillDocument | null
  saving: boolean
  onOpenChange: (open: boolean) => void
  onSave: (submission: SkillEditSubmission) => Promise<void>
}

export function SkillEditDialogView({
  open,
  entry,
  editableScope,
  document,
  saving,
  onOpenChange,
  onSave,
}: SkillEditDialogViewProps) {
  const isDraft = entry?.name === '__draft__'
  const readOnly = !isDraft && entry != null && entry.scope !== editableScope
  const [state, dispatch] = useReducer(skillEditReducer, initialSkillEditState)

  useEffect(() => {
    if (isDraft) {
      dispatch({ type: 'reset-draft' })
      return
    }
    if (document) {
      dispatch({ type: 'hydrate', document })
    }
  }, [document, isDraft])

  const handleSave = async () => {
    try {
      dispatch({ type: 'set-error', value: null })
      const name = state.name.trim()
      const description = state.description.trim()
      if (!name) {
        throw new Error('Name is required')
      }
      if (!description) {
        throw new Error('Description is required')
      }
      await onSave({
        name,
        description,
        body: state.body,
        frontmatter: {
          name,
          description,
          ...state.frontmatter,
        },
      })
    }
    catch (error) {
      dispatch({
        type: 'set-error',
        value: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {isDraft ? 'Create Skill' : readOnly ? 'View Skill' : 'Edit Skill'}
          </DialogTitle>
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
              value={state.name}
              onChange={event => dispatch({ type: 'set-name', value: event.target.value })}
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
              value={state.description}
              onChange={event =>
                dispatch({ type: 'set-description', value: event.target.value })}
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
              value={state.body}
              onChange={event => dispatch({ type: 'set-body', value: event.target.value })}
              readOnly={readOnly}
              spellCheck={false}
              rows={8}
              className="min-h-32 font-mono text-xs"
              data-testid="skill-body-editor"
            />
          </div>
          {state.error && <p className="text-[11px] text-destructive">{state.error}</p>}
        </div>

        {!readOnly && (
          <DialogFooter variant="bare">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving}
              data-testid="skill-save-btn"
            >
              {saving && <Spinner className="size-3.5" />}
              {isDraft ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
