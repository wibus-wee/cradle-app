import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createAutomation, listAutomationDefinitions, runAutomationNow, stopAutomationRun, updateAutomation, updateAutomationRunTriage } from './api-client'

export const automationQueryKeys = {
  definitions: (workspaceId?: string | null) => workspaceId ? ['automations', 'definitions', { workspaceId }] as const : ['automations', 'definitions'] as const,
  runs: (automationId: string) => ['automations', automationId, 'runs'] as const,
  artifacts: (automationId: string) => ['automations', automationId, 'artifacts'] as const,
}

export function useAutomationDefinitions(workspaceId?: string | null) {
  return useQuery({
    queryKey: automationQueryKeys.definitions(workspaceId),
    queryFn: () => listAutomationDefinitions(workspaceId),
    staleTime: 15_000,
    retry: 1,
  })
}

export function useCreateAutomation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createAutomation,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['automations', 'definitions'] })
    },
  })
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string, input: Parameters<typeof updateAutomation>[1] }) => updateAutomation(id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['automations', 'definitions'] })
    },
  })
}

export function useRunAutomationNow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: runAutomationNow,
    onSuccess: async (_run, automationId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['automations', 'definitions'] }),
        queryClient.invalidateQueries({ queryKey: automationQueryKeys.runs(automationId) }),
        queryClient.invalidateQueries({ queryKey: automationQueryKeys.artifacts(automationId) }),
      ])
    },
  })
}

export function useStopAutomationRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: stopAutomationRun,
    onSuccess: async (_run, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: automationQueryKeys.runs(input.automationId) }),
        queryClient.invalidateQueries({ queryKey: ['automations', 'triage'] }),
      ])
    },
  })
}

export function useUpdateAutomationRunTriage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateAutomationRunTriage,
    onSuccess: async (_run, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: automationQueryKeys.runs(input.automationId) }),
        queryClient.invalidateQueries({ queryKey: ['automations', 'triage'] }),
      ])
    },
  })
}
