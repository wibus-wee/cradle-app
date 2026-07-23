import { CloseLine as XIcon } from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent } from '~/components/ui/dialog'

import { SkillImportAsideView } from './skill-import-aside-view'
import type { SkillImportDialogViewState } from './skill-import-contract'
import { SkillImportDoneView } from './skill-import-done-view'
import { SkillImportFetchingView } from './skill-import-fetching-view'
import { SkillImportInputView } from './skill-import-input-view'
import { SkillImportSelectView } from './skill-import-select-view'
import { SkillImportStepDots } from './skill-import-step-dots'
import type { SkillScope } from './types'

interface SkillImportDialogViewProps {
  open: boolean
  editableScope: SkillScope
  state: SkillImportDialogViewState
  isFetching: boolean
  onOpenChange: (open: boolean) => void
  onClose: () => void
  onFetch: (source: string) => void
  onToggle: (skillDir: string) => void
  onToggleAll: () => void
  onInstall: () => void
}

export function SkillImportDialogView({
  open,
  editableScope,
  state,
  isFetching,
  onOpenChange,
  onClose,
  onFetch,
  onToggle,
  onToggleAll,
  onInstall,
}: SkillImportDialogViewProps) {
  const { t: tCommon } = useTranslation('common')
  const { t } = useTranslation('skills')

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true)
        }
        else {
          onClose()
        }
      }}
    >
      <DialogContent
        className="w-[calc(100vw-1rem)] overflow-hidden p-0 sm:max-w-240"
        showCloseButton={false}
        data-testid="skill-import-dialog"
      >
        <div className="flex h-[min(32.5rem,calc(100vh-1rem))] flex-col sm:h-130 sm:flex-row">
          <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden sm:w-[58%] sm:border-r sm:border-foreground/6">
            <div className="flex shrink-0 items-center justify-between border-b border-foreground/6 px-6 py-4 sm:px-8">
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-semibold text-foreground">
                  {t('import.title')}
                </span>
                <SkillImportStepDots current={state.step} />
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={tCommon('action.close')}
                className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/30 transition-colors hover:bg-foreground/6 hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
                {state.step === 'input' && (
                  <m.div
                    key="input"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <SkillImportInputView
                      onFetch={onFetch}
                      isFetching={isFetching}
                      error={state.fetchError}
                    />
                  </m.div>
                )}

                {state.step === 'fetching' && (
                  <m.div
                    key="fetching"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <SkillImportFetchingView source={state.sourceInput} />
                  </m.div>
                )}

                {(state.step === 'select' || state.step === 'installing')
                  && state.fetchResult && (
                  <m.div
                    key="select"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <SkillImportSelectView
                      result={state.fetchResult}
                      selected={state.selected}
                      onToggle={onToggle}
                      onToggleAll={onToggleAll}
                      onInstall={onInstall}
                      isInstalling={state.step === 'installing'}
                    />
                  </m.div>
                )}

                {state.step === 'done' && state.importResult && (
                  <m.div
                    key="done"
                    className="h-full"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 12 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <SkillImportDoneView result={state.importResult} onClose={onClose} />
                  </m.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <SkillImportAsideView state={state} scope={editableScope} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
