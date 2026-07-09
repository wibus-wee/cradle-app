/**
 * Trust-on-enable consent dialog (Plans 029/030).
 *
 * Toggling ON an untrusted `externalLocal` plugin must not be a one-click
 * `PATCH`. This dialog fetches the full plugin descriptor (`GET /plugins/:routeSegment`)
 * so the operator can review the permissions it declares *before* activation.
 * Confirming hands control back to the caller, which issues the `PATCH …/enabled`.
 * Built on the design-system `alert-dialog`.
 */
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getPluginsByRouteSegment } from '~/api-gen/sdk.gen'
import type { GetPluginsByRouteSegmentResponse } from '~/api-gen/types.gen'
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
import { Spinner } from '~/components/ui/spinner'

interface TrustConsentDialogProps {
  /** The routeSegment of the plugin to enable, or null when closed. */
  routeSegment: string | null
  /** Called when the operator confirms trust. The caller issues the PATCH. */
  onConfirm: () => void
  /** Called when the dialog is cancelled (button or backdrop). */
  onCancel: () => void
  /** Disable the confirm button + show pending state while the PATCH runs. */
  confirmPending?: boolean
}

export function TrustConsentDialog({ routeSegment, onConfirm, onCancel, confirmPending }: TrustConsentDialogProps) {
  const { t } = useTranslation('settings')
  const open = routeSegment !== null

  const descriptorQuery = useQuery({
    queryKey: ['plugins', 'descriptor', routeSegment],
    queryFn: async () => {
      const { data, error } = await getPluginsByRouteSegment({ path: { routeSegment: routeSegment! } })
      if (error) {
        throw new Error(typeof error === 'string' ? error : JSON.stringify(error))
      }
      return data as GetPluginsByRouteSegmentResponse
    },
    enabled: open,
  })

  const permissions = descriptorQuery.data?.declaredPermissions ?? []

  return (
    <AlertDialog open={open} onOpenChange={next => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('plugins.trust.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('plugins.trust.body')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-60 overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-3">
          <p className="mb-2 text-[12px] font-medium text-foreground">{t('plugins.trust.permissions')}</p>
          {descriptorQuery.isLoading
            ? (
                <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
                  <Spinner className="size-3.5" />
                </div>
              )
            : descriptorQuery.isError
              ? (
                  <p className="text-[12px] text-muted-foreground">{t('plugins.error')}</p>
                )
              : permissions.length === 0
                ? (
                    <p className="text-[12px] text-muted-foreground">{t('plugins.preview.empty')}</p>
                  )
                : (
                    <ul className="flex flex-col gap-2">
                      {permissions.map(permission => (
                        <li key={permission.id} className="flex flex-col gap-0.5">
                          <span className="text-[12px] font-medium text-foreground">
                            {permission.label ?? permission.localId}
                            {permission.required && (
                              <span className="ml-1 text-[10.5px] text-destructive/80">*</span>
                            )}
                          </span>
                          {permission.description && (
                            <span className="text-[11.5px] leading-relaxed text-muted-foreground">{permission.description}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={confirmPending}>
            {t('plugins.trust.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            disabled={confirmPending || descriptorQuery.isLoading}
          >
            {confirmPending ? <Spinner className="size-3.5" /> : t('plugins.trust.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
