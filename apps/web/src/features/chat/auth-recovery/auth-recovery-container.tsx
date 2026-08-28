import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deleteChatSessionsBySessionIdAuthRecoveryMutation,
  getChatSessionsBySessionIdAuthRecoveryQueryKey,
  postChatSessionsBySessionIdAuthRecoveryRetryMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetChatSessionsBySessionIdAuthRecoveryResponse } from '~/api-gen/types.gen'
import { AcpAuthSection } from '~/features/agent-runtimes/acp-auth-section'

import type { AuthRecoveryViewLabels } from './auth-recovery-view'
import { AuthRecoveryView } from './auth-recovery-view'

export function AuthRecoveryContainer({
  sessionId,
  recovery,
}: {
  sessionId: string
  recovery: NonNullable<GetChatSessionsBySessionIdAuthRecoveryResponse>
}) {
  const { t } = useTranslation('chat')
  const queryClient = useQueryClient()
  const [actionError, setActionError] = useState<string | null>(null)
  const queryKey = getChatSessionsBySessionIdAuthRecoveryQueryKey({ path: { sessionId } })

  const clearRecovery = () => {
    queryClient.setQueryData<GetChatSessionsBySessionIdAuthRecoveryResponse>(queryKey, null)
  }

  const retry = useMutation({
    ...postChatSessionsBySessionIdAuthRecoveryRetryMutation(),
    onSuccess: clearRecovery,
    onError: error => setActionError(error.message),
  })
  const dismiss = useMutation({
    ...deleteChatSessionsBySessionIdAuthRecoveryMutation(),
    onSuccess: clearRecovery,
    onError: error => setActionError(error.message),
  })

  const labels: AuthRecoveryViewLabels = {
    title: t('authRecovery.title'),
    description: t('authRecovery.description'),
    retry: t('authRecovery.action.retry'),
    retrying: t('authRecovery.action.retrying'),
    dismiss: t('authRecovery.action.dismiss'),
    dismissing: t('authRecovery.action.dismissing'),
  }
  const configurationTarget = recovery.configurationTarget
  const isAcp = configurationTarget.namespace === 'acp'

  return (
    <AuthRecoveryView
      labels={labels}
      configuration={isAcp
        ? (
            <AcpAuthSection
              agentId={configurationTarget.resourceId}
              configuredMethodId={null}
              onSaved={() => retry.mutate({ path: { sessionId } })}
            />
          )
        : <p className="text-[12px] text-muted-foreground">{t('authRecovery.unsupportedTarget')}</p>}
      error={actionError}
      isRetrying={retry.isPending}
      isDismissing={dismiss.isPending}
      onRetry={() => {
        setActionError(null)
        retry.mutate({ path: { sessionId } })
      }}
      onDismiss={() => {
        setActionError(null)
        dismiss.mutate({ path: { sessionId } })
      }}
    />
  )
}
