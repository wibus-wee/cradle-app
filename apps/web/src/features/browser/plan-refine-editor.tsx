import { PencilLine as PencilIcon } from '@mingcute/react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { MarkdownEditor } from '~/components/editor/markdown-editor'
import { cn } from '~/lib/cn'

export const PLAN_REFINE_EDITOR_SAVE_EVENT = 'cradle:browser-panel:plan-refine-save'
export const PLAN_REFINE_EDITOR_DIRTY_EVENT = 'cradle:browser-panel:plan-refine-dirty'

interface PlanRefineEditorProps {
  tabId: string
  title: string
  text: string
  className?: string
}

export interface PlanRefineEditorSaveDetail {
  tabId: string
  markdown: string
}

export interface PlanRefineEditorDirtyDetail {
  tabId: string
  dirty: boolean
}

export function PlanRefineEditor({ tabId, title, text, className }: PlanRefineEditorProps) {
  const initialTextRef = useRef(text)
  const draftRef = useRef(text)
  const dirtyRef = useRef(false)
  const [dirty, setDirty] = useState(false)

  const updateDirty = useCallback((nextDirty: boolean) => {
    if (dirtyRef.current === nextDirty) {
      return
    }
    dirtyRef.current = nextDirty
    setDirty(nextDirty)
    window.dispatchEvent(new CustomEvent<PlanRefineEditorDirtyDetail>(
      PLAN_REFINE_EDITOR_DIRTY_EVENT,
      { detail: { tabId, dirty: nextDirty } },
    ))
  }, [tabId])

  useEffect(() => {
    initialTextRef.current = text
    draftRef.current = text
    updateDirty(false)
  }, [text, updateDirty])

  const handleChange = useCallback((markdown: string) => {
    draftRef.current = markdown
    updateDirty(markdown !== initialTextRef.current)
  }, [updateDirty])

  const handleSave = useCallback((markdown: string) => {
    const saveEvent = new CustomEvent<PlanRefineEditorSaveDetail>(
      PLAN_REFINE_EDITOR_SAVE_EVENT,
      {
        cancelable: true,
        detail: { tabId, markdown },
      },
    )
    window.dispatchEvent(saveEvent)
    if (!saveEvent.defaultPrevented) {
      updateDirty(markdown !== initialTextRef.current)
      return
    }

    draftRef.current = markdown
    initialTextRef.current = markdown
    updateDirty(false)
  }, [tabId, updateDirty])

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)}>
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <PencilIcon className="size-3.5 shrink-0 !text-muted-foreground/70" aria-hidden="true" />
          <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{title}</span>
        </div>
        <span
          className={cn(
            'shrink-0 text-[11px] font-medium tabular-nums',
            dirty ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground/70',
          )}
        >
          {dirty ? 'Unsaved' : 'Saved'}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <MarkdownEditor
          content={text}
          documentId={tabId}
          onChange={handleChange}
          onSave={handleSave}
          saveOnBlur={false}
          placeholder="Refine the plan..."
          className="min-h-full"
        />
      </div>
    </div>
  )
}
