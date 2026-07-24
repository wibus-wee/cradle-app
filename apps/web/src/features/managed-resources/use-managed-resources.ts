import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  deleteManagedResourcesByNamespaceByResourceTypeByResourceId,
  getManagedResourcesOptions,
  getManagedResourcesQueryKey,
  postManagedResourcesByNamespaceByResourceTypeByResourceIdInstall,
  postManagedResourcesByNamespaceByResourceTypeByResourceIdUpdate,
} from './api/managed-resources-api'
import type { ManagedResource } from './projection'

export type ManagedResourceAction = 'install' | 'update' | 'uninstall'

const EMPTY_RESOURCES: ManagedResource[] = []

export function useManagedResources() {
  const query = useQuery({ ...getManagedResourcesOptions() })
  return {
    ...query,
    resources: query.data ?? EMPTY_RESOURCES,
  }
}

export function useManagedResourceAction(resource: ManagedResource) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (action: ManagedResourceAction) => {
      const path = resource.key
      if (action === 'install') {
        const { data } = await postManagedResourcesByNamespaceByResourceTypeByResourceIdInstall({ path, throwOnError: true })
        return data
      }
      if (action === 'update') {
        const { data } = await postManagedResourcesByNamespaceByResourceTypeByResourceIdUpdate({ path, throwOnError: true })
        return data
      }
      const { data } = await deleteManagedResourcesByNamespaceByResourceTypeByResourceId({ path, throwOnError: true })
      return data
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: getManagedResourcesQueryKey() })
    },
  })
}
