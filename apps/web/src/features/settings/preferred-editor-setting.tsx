import { useTranslation } from 'react-i18next'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { EditorIcon } from '~/features/editor/editor-icon'
import { useAvailableEditors, usePreferredEditor } from '~/features/editor/use-editor-preferences'

import { SettingsRow } from './settings-row'

export function PreferredEditorSetting() {
  const { t } = useTranslation('editor')
  const { data: available = [], isLoading } = useAvailableEditors()
  const { preferredEditorId, setPreferred } = usePreferredEditor(available)
  const preferred = available.find(editor => editor.id === preferredEditorId)

  return (
    <SettingsRow label={t('favoriteLabel')} description={t('favoriteHint')}>
      {isLoading
        ? <Spinner className="mx-3 size-4" aria-label={t('loading')} />
        : available.length > 0 && preferred
          ? (
              <Select value={preferred.id} onValueChange={setPreferred}>
                <SelectTrigger className="w-56" aria-label={t('favoriteLabel')} data-testid="desktop-preferred-editor">
                  <EditorIcon editor={preferred} />
                  <SelectValue>{preferred.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {available.map(editor => (
                    <SelectItem key={editor.id} value={editor.id}>
                      <EditorIcon editor={editor} />
                      {editor.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          : <span className="text-[12px] text-muted-foreground">{t('noneFound')}</span>}
    </SettingsRow>
  )
}
