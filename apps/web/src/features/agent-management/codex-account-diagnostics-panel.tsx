import { useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  getProviderTargetsByProviderTargetIdCodexAccountDiagnosticsOptions,
  getProviderTargetsByProviderTargetIdCodexWhamDiagnosticsOptions,
  postProviderTargetsByProviderTargetIdCodexRateLimitResetCreditConsumeMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'
import { apiErrorMessage } from '~/lib/api-error'

import { CodexAccountDiagnosticsPanelView } from './codex-account-diagnostics-panel-view'

export function CodexAccountDiagnosticsPanel({ providerTargetId }: { providerTargetId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetAttemptKey, setResetAttemptKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('account')

  const diagnosticsQuery = useQuery({
    ...getProviderTargetsByProviderTargetIdCodexAccountDiagnosticsOptions({
      path: { providerTargetId },
    }),
    enabled: false,
    retry: false,
  })

  const whamQuery = useQuery({
    ...getProviderTargetsByProviderTargetIdCodexWhamDiagnosticsOptions({
      path: { providerTargetId },
    }),
    enabled: false,
    retry: false,
  })
  const {
    data: diagnosticsData,
    error: diagnosticsError,
    isFetching: diagnosticsLoading,
    refetch: refetchDiagnostics,
  } = diagnosticsQuery
  const {
    data: whamData,
    error: whamError,
    isFetching: whamLoading,
    refetch: refetchWham,
  } = whamQuery

  const resetCredit = useMutation({
    ...postProviderTargetsByProviderTargetIdCodexRateLimitResetCreditConsumeMutation(),
    onSuccess: (result) => {
      setResetAttemptKey(null)
      toastManager.add({
        type: result.outcome === 'reset' ? 'success' : 'info',
        title: formatResetOutcome(result.outcome),
      })
      void refetchDiagnostics()
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: 'Reset failed',
        description: apiErrorMessage(error),
      })
    },
  })

  useEffect(() => {
    if (
      dialogOpen
      && diagnosticsData === undefined
      && !diagnosticsLoading
      && !diagnosticsError
    ) {
      void refetchDiagnostics()
    }
  }, [
    dialogOpen,
    diagnosticsData,
    diagnosticsError,
    diagnosticsLoading,
    refetchDiagnostics,
  ])

  useEffect(() => {
    if (
      dialogOpen
      && activeTab === 'rate-limits'
      && whamData === undefined
      && !whamLoading
      && !whamError
    ) {
      void refetchWham()
    }
  }, [
    activeTab,
    dialogOpen,
    whamData,
    whamError,
    whamLoading,
    refetchWham,
  ])

  const refresh = () => {
    void refetchDiagnostics()
    if (activeTab === 'rate-limits' || whamData !== undefined) {
      void refetchWham()
    }
  }

  const openResetDialog = () => {
    setResetAttemptKey(current => current ?? crypto.randomUUID())
    setResetDialogOpen(true)
  }

  const consumeResetCredit = () => {
    const idempotencyKey = resetAttemptKey ?? crypto.randomUUID()
    setResetAttemptKey(idempotencyKey)
    resetCredit.mutate({
      path: { providerTargetId },
      body: { idempotencyKey },
    })
    setResetDialogOpen(false)
  }

  return (
    <CodexAccountDiagnosticsPanelView
      diagnostics={diagnosticsData ?? null}
      diagnosticsLoading={diagnosticsLoading}
      diagnosticsError={diagnosticsError}
      whamDiagnostics={whamData ?? null}
      whamLoading={whamLoading}
      resetPending={resetCredit.isPending}
      dialogOpen={dialogOpen}
      resetDialogOpen={resetDialogOpen}
      activeTab={activeTab}
      onDialogOpenChange={setDialogOpen}
      onResetDialogOpenChange={setResetDialogOpen}
      onActiveTabChange={setActiveTab}
      onRefresh={refresh}
      onUseResetCredit={openResetDialog}
      onCancelResetCredit={() => setResetAttemptKey(null)}
      onConfirmResetCredit={consumeResetCredit}
    />
  )
}

function formatResetOutcome(outcome: 'reset' | 'nothingToReset' | 'noCredit' | 'alreadyRedeemed'): string {
  switch (outcome) {
    case 'reset':
      return 'Limit reset'
    case 'nothingToReset':
      return 'Nothing to reset'
    case 'noCredit':
      return 'No reset credit'
    case 'alreadyRedeemed':
      return 'Already redeemed'
  }
}
