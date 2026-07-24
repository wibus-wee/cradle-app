import { LoadingLine } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { SettingsGroup } from '~/features/settings/settings-container'
import { SettingsRow } from '~/features/settings/settings-row'

import type { WorkspaceRecognition } from './use-workspace'

export interface WorkspaceRecognitionDialogViewProps {
  recognition: WorkspaceRecognition | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onOpenAsCradleWorkspace: () => Promise<void>
  onAddAsSingleFolder: () => Promise<void>
}

export function WorkspaceRecognitionDialogView({
  recognition,
  busy,
  onOpenChange,
  onOpenAsCradleWorkspace,
  onAddAsSingleFolder,
}: WorkspaceRecognitionDialogViewProps) {
  const { t } = useTranslation('workspace')
  const open = recognition !== null
  const inspection = recognition?.inspection
  const invalid = inspection ? !inspection.configValid : false
  const needsFlagEnable = inspection
    ? !inspection.featureFlagEnabled
    : false
  const alreadyImported = inspection?.alreadyImported ?? false
  const config = inspection?.config ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle>
            {invalid
              ? t('workspace.dialog.recognitionInvalidTitle')
              : t('workspace.dialog.recognitionTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 px-5 pb-4">
          <p className="text-sm text-muted-foreground">
            {invalid
              ? t('workspace.dialog.recognitionInvalidDescription')
              : t('workspace.dialog.recognitionDescription')}
          </p>

          {invalid && inspection?.configError
            ? (
                <pre className="max-h-24 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-xs text-muted-foreground">
                  {inspection.configError}
                </pre>
              )
            : null}

          {config && !invalid
            ? (
                <SettingsGroup>
                  <SettingsRow
                    label={t('workspace.dialog.recognitionNameLabel')}
                  >
                    <span className="text-sm font-medium">{config.name}</span>
                  </SettingsRow>
                  <SettingsRow
                    label={t('workspace.dialog.recognitionFoldersLabel')}
                    vertical
                  >
                    <ul className="grid gap-1">
                      {config.folders.map(folder => (
                        <li
                          key={`${folder.name}:${folder.path}`}
                          className="grid min-w-0 grid-cols-1 gap-1 rounded-lg bg-muted/40 px-2 py-1.5 text-xs sm:grid-cols-[minmax(5rem,0.3fr)_minmax(0,1fr)] sm:gap-2"
                        >
                          <span className="font-medium">{folder.name}</span>
                          <span
                            className="min-w-0 break-all font-mono text-muted-foreground sm:truncate"
                            title={folder.path}
                          >
                            {folder.path}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </SettingsRow>
                </SettingsGroup>
              )
            : null}

          {needsFlagEnable && !invalid
            ? (
                <p className="text-xs text-muted-foreground">
                  {t('workspace.dialog.recognitionExperimentalNote')}
                </p>
              )
            : null}
          {alreadyImported
            ? (
                <p className="text-xs text-muted-foreground">
                  {t('workspace.dialog.recognitionAlreadyImported')}
                </p>
              )
            : null}
        </div>
        <DialogFooter
          variant="bare"
          className="flex-col border-t px-5 py-3 sm:flex-row"
        >
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            {t('workspace.dialog.cancel')}
          </Button>
          {!invalid
            ? (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={busy}
                  onClick={() => void onOpenAsCradleWorkspace()}
                >
                  {busy ? <LoadingLine className="animate-spin" /> : null}
                  {needsFlagEnable
                    ? t('workspace.dialog.recognitionOpenExperimental')
                    : t('workspace.dialog.recognitionOpen')}
                </Button>
              )
            : null}
          <Button
            type="button"
            variant={invalid ? 'default' : 'ghost'}
            className="w-full sm:w-auto"
            disabled={busy}
            onClick={() => void onAddAsSingleFolder()}
          >
            {t('workspace.dialog.recognitionAddSingle')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
