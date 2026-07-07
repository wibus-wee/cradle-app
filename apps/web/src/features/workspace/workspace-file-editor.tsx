import {
  CheckLine as CheckIcon,
  SaveLine as SaveIcon,
} from '@mingcute/react'
import Editor from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import { useThemeStore } from '~/store/theme'

import {
  buildWorkspaceFileContentMutationInput,
  useWorkspaceFileContent,
  useWorkspaceFileContentMutation,
} from './use-workspace-file-content'
import { getMonacoLanguage } from './workspace-file-language'

function useMonacoTheme(): 'vs' | 'vs-dark' {
  const mode = useThemeStore(s => s.mode)
  if (mode === 'dark') {
    return 'vs-dark'
  }
  if (mode === 'light') {
    return 'vs'
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'vs-dark'
  }
  return 'vs'
}

export function WorkspaceFileEditor({ workspaceId, path }: { workspaceId: string, path: string }) {
  const fileQuery = useWorkspaceFileContent(workspaceId, path)
  const saveMutation = useWorkspaceFileContentMutation(workspaceId, path)
  const monacoTheme = useMonacoTheme()
  const content = fileQuery.data?.content
  const fileIdentity = `${workspaceId}\0${path}`
  const saveDraftRef = useRef<() => Promise<void>>(async () => {})
  const [editorState, setEditorState] = useState({
    fileIdentity,
    draft: '',
    savedContent: '',
    saveError: null as string | null,
  })
  const isDirty = editorState.draft !== editorState.savedContent
  const isSaving = saveMutation.isPending

  useEffect(() => {
    if (typeof content !== 'string') {
      return
    }

    setEditorState((current) => {
      const currentFileChanged = current.fileIdentity !== fileIdentity
      const currentDraftDirty = current.draft !== current.savedContent
      if (!currentFileChanged && currentDraftDirty) {
        return current
      }
      if (
        !currentFileChanged
        && current.draft === content
        && current.savedContent === content
        && current.saveError === null
      ) {
        return current
      }
      return {
        fileIdentity,
        draft: content,
        savedContent: content,
        saveError: null,
      }
    })
  }, [content, fileIdentity])

  const saveDraft = async () => {
    if (!isDirty || isSaving) {
      return
    }

    const contentToSave = editorState.draft
    setEditorState(current => ({ ...current, saveError: null }))
    try {
      await saveMutation.mutateAsync(buildWorkspaceFileContentMutationInput(workspaceId, path, contentToSave))
      setEditorState(current => ({
        ...current,
        savedContent: contentToSave,
        saveError: null,
      }))
    }
    catch (error) {
      setEditorState(current => ({
        ...current,
        saveError: error instanceof Error ? error.message : 'Unable to save this file.',
      }))
    }
  }

  useEffect(() => {
    saveDraftRef.current = saveDraft
  }, [saveDraft])

  let saveLabel = 'Saved'
  if (isSaving) {
    saveLabel = 'Saving'
  }
  else if (isDirty) {
    saveLabel = 'Save'
  }

  let statusMessage = 'Saved'
  let statusClassName = 'text-muted-foreground'
  if (editorState.saveError) {
    statusMessage = editorState.saveError
    statusClassName = 'text-destructive'
  }
  else if (isDirty) {
    statusMessage = 'Unsaved changes'
    statusClassName = 'text-amber-600 dark:text-amber-300'
  }

  let saveIcon = <CheckIcon className="size-3" aria-hidden="true" />
  if (isSaving) {
    saveIcon = <Spinner className="size-3" aria-hidden="true" />
  }
  else if (isDirty) {
    saveIcon = <SaveIcon className="size-3" aria-hidden="true" />
  }

  if (fileQuery.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <Spinner className="size-4 !text-muted-foreground/50" aria-hidden="true" />
      </div>
    )
  }

  if (fileQuery.isError || content === null || content === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background px-6 text-center">
        <p className="text-sm text-muted-foreground">Unable to read this file as text.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-2">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className={cn('truncate text-[11px]', statusClassName)}>
            {statusMessage}
          </p>
        </div>
        <Button
          type="button"
          size="xs"
          variant={isDirty ? 'default' : 'outline'}
          onClick={() => void saveDraft()}
          disabled={!isDirty || isSaving}
          aria-label="Save file"
        >
          {saveIcon}
          {saveLabel}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          key={`${workspaceId}:${path}`}
          value={editorState.draft}
          language={getMonacoLanguage(path)}
          theme={monacoTheme}
          path={`${workspaceId}/${path}`}
          loading={null}
          onChange={(value) => {
            setEditorState(current => ({
              ...current,
              draft: value ?? '',
              saveError: null,
            }))
          }}
          onMount={(editor, monaco) => {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              void saveDraftRef.current()
            })
          }}
          options={{
            automaticLayout: true,
            folding: true,
            fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
            fontSize: 13,
            lineNumbers: 'on',
            minimap: { enabled: false },
            readOnly: isSaving,
            renderLineHighlight: 'line',
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            wordWrap: 'off',
          }}
        />
      </div>
    </div>
  )
}
