// Split-button "Open in editor": primary action opens the path in the preferred
// editor; the dropdown lists every detected editor and selecting one opens the
// path in it AND persists it as the favorite. Degrades to hidden in the browser
// (no native IPC) or when there is no path.
import { DownSmallLine as ChevronDownIcon } from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { cn } from '~/lib/cn'

import { EditorIcon } from './editor-icon'
import { useAvailableEditors, usePreferredEditor } from './use-editor-preferences'

interface OpenInPickerProps {
  path: string | null
  className?: string
  size?: 'xs' | 'sm'
}

export function OpenInPicker({ path, className, size = 'sm' }: OpenInPickerProps) {
  const { t } = useTranslation('editor')
  const { data: available = [] } = useAvailableEditors()
  const { preferredEditorId, setPreferred } = usePreferredEditor(available)
  const [busy, setBusy] = useState(false)

  if (available.length === 0 || !path) {
    return null
  }

  const preferred = available.find(editor => editor.id === preferredEditorId) ?? available[0]!

  const open = async (editorId: string) => {
    setBusy(true)
    try {
      const { openInEditor } = await import('./use-editor-preferences')
      await openInEditor(path, editorId)
    }
    finally {
      setBusy(false)
    }
  }

  const handlePrimary = () => {
    void open(preferred.id)
  }

  const handleSelect = (editorId: string) => {
    setPreferred(editorId)
    void open(editorId)
  }

  return (
    <div className={cn('flex items-center overflow-hidden rounded-md border border-border/60', className)}>
      <Button
        variant="ghost"
        size={size}
        onClick={handlePrimary}
        disabled={busy}
        className="rounded-r-none border-r border-border/60"
        title={t('openInPreferred', { editor: preferred.label })}
      >
        <EditorIcon editor={preferred} className="size-3.5" />
        {t('open')}
      </Button>
      <Menu>
        <MenuTrigger
          render={(
            <Button
              variant="ghost"
              size={size}
              disabled={busy}
              className="rounded-l-none px-1.5"
              aria-label={t('chooseEditor')}
            />
          )}
        >
          <ChevronDownIcon className="size-3" />
        </MenuTrigger>
        <MenuPopup align="end" className="w-52">
          {available.map(editor => (
            <MenuItem
              key={editor.id}
              onClick={() => handleSelect(editor.id)}
              className={cn(editor.id === preferred.id && 'font-medium')}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <EditorIcon editor={editor} />
                  {editor.label}
                </span>
                {editor.id === preferred.id && <span className="text-xs text-muted-foreground">✓</span>}
              </span>
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  )
}
