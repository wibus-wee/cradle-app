import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toastManager } from '~/components/ui/toast'
import { apiErrorMessage } from '~/lib/api-error'
import { openWork } from '~/navigation/navigation-commands'

import { useRedetectWork, useWorkAttention } from './use-work'
import { WorkAttentionView } from './work-attention-view'

export function WorkAttention() {
  const { t } = useTranslation('awaits')
  const attentionQuery = useWorkAttention()
  const redetect = useRedetectWork()
  const [redetectingWorkId, setRedetectingWorkId] = useState<string | null>(null)

  const handleRedetect = async (workId: string) => {
    setRedetectingWorkId(workId)
    try {
      await redetect.mutateAsync({ path: { id: workId } })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('action.redetectFailed'),
        description: apiErrorMessage(error),
      })
    }
    finally {
      setRedetectingWorkId(null)
    }
  }

  return (
    <WorkAttentionView
      items={attentionQuery.data ?? []}
      isReady={attentionQuery.isSuccess}
      hasError={attentionQuery.isError}
      redetectingWorkId={redetectingWorkId}
      onOpenWork={openWork}
      onRedetect={workId => void handleRedetect(workId)}
    />
  )
}
