import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'

export interface WorkspaceTextInputDialogViewProps {
  open: boolean
  title: string
  initialValue: string
  label: string
  confirmLabel: string
  onOpenChange: (open: boolean) => void
  onCommit: (value: string) => Promise<void>
}

export function WorkspaceTextInputDialogView({
  open,
  title,
  initialValue,
  label,
  confirmLabel,
  onOpenChange,
  onCommit,
}: WorkspaceTextInputDialogViewProps) {
  const { t } = useTranslation('workspace')
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) {
      setValue(initialValue)
    }
  }, [initialValue, open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void onCommit(value)
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={event => setValue(event.currentTarget.value)}
            onFocus={event => event.currentTarget.select()}
            aria-label={label}
          />
          <DialogFooter variant="bare">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t('workspace.dialog.cancel')}
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
