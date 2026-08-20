import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'

import type { FabricNode } from './types'

export interface RemoveDeviceDialogProps {
  node: FabricNode | null
  busy: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (nodeId: string) => void
}

export function RemoveDeviceDialog({
  node,
  busy,
  onOpenChange,
  onConfirm,
}: RemoveDeviceDialogProps) {
  const { t } = useTranslation('nodes')
  return (
    <AlertDialog open={node !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('removeDevice.title', { name: node?.displayName ?? '' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('removeDevice.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t('removeDevice.keep')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy || node === null}
            onClick={(event) => {
              event.preventDefault()
              if (node) {
                onConfirm(node.nodeId)
              }
            }}
            data-testid="remove-device-confirm"
          >
            {t('removeDevice.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
