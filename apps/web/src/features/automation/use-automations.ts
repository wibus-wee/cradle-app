import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createAutomation,
  listAutomationArtifacts,
  listAutomationDefinitions,
  listAutomationRuns,
  listAutomationTriage,
  runAutomationNow,
  stopAutomationRun,
  updateAutomation,
  updateAutomationRunTriage,
} from './api/automation'

export type {
  AutomationArtifact,
  AutomationDefinition,
  AutomationRun,
  AutomationRunStatus,
  CreateAutomationInput,
} from './api/automation'

export const automationQueryKeys = {
  definitions: (workspaceId?: string | null) => ['automations', 'definitions', { workspaceId: workspaceId ?? null }] as const,
  definitionsRoot: ['automations', 'definitions'] as const,
  runs: (automationId: string) => ['automations', 'runs', automationId] as const,
  artifacts: (automationId: string) => ['automations', 'artifacts', automationId] as const,
  triage: (workspaceId?: string | null) => ['automations', 'triage', { workspaceId: workspaceId ?? null }] as const,
}

export function useAutomationDefinitions(workspaceId?: string | null) {
  return useQuery({
    queryKey: automationQueryKeys.definitions(workspaceId),
    queryFn: () => listAutomationDefinitions(workspaceId),
    staleTime: 15_000,
    retry: 1,
  })
}

export function useAutomationRuns(automationId: string | null) {
  return useQuery({
    queryKey: automationQueryKeys.runs(automationId ?? 'missing'),
    queryFn: () => listAutomationRuns(automationId!),
    enabled: automationId !== null,
    staleTime: 10_000,
    retry: 1,
  })
}

export function useAutomationArtifacts(automationId: string | null) {
  return useQuery({
    queryKey: automationQueryKeys.artifacts(automationId ?? 'missing'),
    queryFn: () => listAutomationArtifacts(automationId!),
    enabled: automationId !== null,
    staleTime: 10_000,
    retry: 1,
  })
}

export function useAutomationTriage(workspaceId?: string | null) {
  return useQuery({
    queryKey: automationQueryKeys.triage(workspaceId),
    queryFn: () => listAutomationTriage(workspaceId),
    staleTime: 10_000,
    retry: 1,
  })
}

async function invalidateAutomationQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  automationId?: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: automationQueryKeys.definitionsRoot }),
    queryClient.invalidateQueries({ queryKey: automationQueryKeys.triage() }),
    ...(automationId
      ? [
          queryClient.invalidateQueries({ queryKey: automationQueryKeys.runs(automationId) }),
          queryClient.invalidateQueries({ queryKey: automationQueryKeys.artifacts(automationId) }),
        ]
      : []),
  ])
}

export function useCreateAutomation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createAutomation,
    onSuccess: () => invalidateAutomationQueries(queryClient),
  })
}

export function useUpdateAutomation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }: { id: string, input: Parameters<typeof updateAutomation>[1] }) => updateAutomation(id, input),
    onSuccess: (_definition, { id }) => invalidateAutomationQueries(queryClient, id),
  })
}

export function useRunAutomationNow() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: runAutomationNow,
    onSuccess: (_run, automationId) => invalidateAutomationQueries(queryClient, automationId),
  })
}

export function useStopAutomationRun() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: stopAutomationRun,
    onSuccess: (_run, input) => invalidateAutomationQueries(queryClient, input.automationId),
  })
}

export function useUpdateAutomationRunTriage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateAutomationRunTriage,
    onSuccess: (_run, input) => invalidateAutomationQueries(queryClient, input.automationId),
  })
}
