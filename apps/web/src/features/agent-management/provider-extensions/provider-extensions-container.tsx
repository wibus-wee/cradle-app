import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getProviderTargetsByProviderTargetIdExtensionsOptions,
  getProviderTargetsByProviderTargetIdExtensionsQueryKey,
  getProviderTargetsQueryKey,
  putProviderTargetsByProviderTargetIdExtensionsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'
import { apiErrorMessage } from '~/lib/api-error'

import { ProviderExtensionsView } from './provider-extensions-view'

export function ProviderExtensionsContainer({
  providerTargetId,
  disabled = false,
}: {
  providerTargetId: string
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const queryOptions = getProviderTargetsByProviderTargetIdExtensionsOptions({
    path: { providerTargetId },
  })
  const extensionsQuery = useQuery(queryOptions)
  const updateExtension = useMutation({
    ...putProviderTargetsByProviderTargetIdExtensionsMutation(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getProviderTargetsByProviderTargetIdExtensionsQueryKey({
            path: { providerTargetId },
          }),
        }),
        queryClient.invalidateQueries({ queryKey: getProviderTargetsQueryKey() }),
      ])
    },
    onError: (error) => {
      toastManager.add({
        type: 'error',
        title: 'Provider 扩展更新失败',
        description: apiErrorMessage(error),
      })
    },
  })

  return (
    <ProviderExtensionsView
      extensions={extensionsQuery.data ?? []}
      loading={extensionsQuery.isLoading}
      disabled={disabled}
      pendingExtensionKey={updateExtension.isPending && updateExtension.variables
        ? `${updateExtension.variables.body.owner}:${updateExtension.variables.body.id}`
        : null}
      onEnabledChange={(extension, enabled) => {
        updateExtension.mutate({
          path: { providerTargetId },
          body: {
            owner: extension.extensionOwner,
            id: extension.extensionId,
            enabled,
          },
        })
      }}
    />
  )
}
