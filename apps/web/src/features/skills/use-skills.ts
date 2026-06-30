import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'

import {
  deleteSkillsDocument,
  getSkills,
  getSkillsDocument,
  postSkills,
  postSkillsCancelFetch,
  postSkillsExport,
  postSkillsFetchSource,
  postSkillsImport,
  postSkillsImportFromFetch,
  putSkillsDocument,
} from '~/api-gen/sdk.gen'
import type { DiscoveredSkill, ParsedSkillSource, SkillDocument, SkillInventoryEntry, SkillScope } from '~/features/skills/types'

export interface SkillQueryContext {
  workspaceId?: string | null
  agentId?: string | null
}

const skillsInventoryQueryKey = (context?: SkillQueryContext) =>
  ['skills', 'inventory', context?.workspaceId ?? 'global', context?.agentId ?? 'no-agent'] as const
const skillDocumentQueryKey = (context: SkillQueryContext | undefined, scope: SkillScope, name: string | null) =>
  ['skills', 'document', context?.workspaceId ?? 'global', context?.agentId ?? 'no-agent', scope, name ?? ''] as const
const SkillScopeSchema = z.enum(['builtin', 'legacy', 'global', 'repository', 'workspace', 'agent'])
const SkillDocumentSchema = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
  location: z.string(),
  scope: SkillScopeSchema,
  rootDir: z.string(),
  skillDir: z.string(),
})
const SkillInventoryListSchema = z.array(z.object({
  name: z.string(),
  description: z.string(),
  location: z.string(),
  scope: SkillScopeSchema,
  rootDir: z.string(),
  skillDir: z.string(),
  active: z.boolean(),
  shadowedBy: SkillScopeSchema.nullable(),
})).default([])
const SkillExportResponseSchema = z.object({
  destinationDir: z.string(),
  ownerBoundary: z.object({
    classification: z.literal('non-cradle-owned'),
    owner: z.literal('user-selected-export-directory'),
    consentRequired: z.literal(true),
    consentConfirmed: z.literal(true),
    destinationDir: z.string(),
    targetPath: z.string(),
  }),
})
const ParsedSkillSourceSchema = z.object({
  type: z.enum(['github', 'gitlab', 'git', 'local']),
  url: z.string(),
  ref: z.string().optional(),
  subpath: z.string().optional(),
  label: z.string(),
})
const DiscoveredSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  skillDir: z.string(),
  relativePath: z.string(),
})
const SkillFetchSourceResponseSchema = z.object({
  sessionId: z.string(),
  source: ParsedSkillSourceSchema,
  skills: z.array(DiscoveredSkillSchema),
})
const SkillImportFromFetchResponseSchema = z.object({
  imported: z.array(SkillDocumentSchema),
  errors: z.array(z.object({
    dir: z.string(),
    error: z.string(),
  })),
})

function toIpcContext(context?: SkillQueryContext): { workspaceId?: string | null, agentId?: string | null } {
  return {
    workspaceId: context?.workspaceId ?? null,
    agentId: context?.agentId ?? null,
  }
}

export function useSkills(context?: SkillQueryContext) {
  const queryClient = useQueryClient()
  const inventoryQueryKey = skillsInventoryQueryKey(context)

  const { data: inventory = [], isLoading, isSuccess } = useQuery({
    queryKey: inventoryQueryKey,
    queryFn: async (): Promise<SkillInventoryEntry[]> => {
      const ctx = toIpcContext(context)
      const { data } = await getSkills({
        query: { workspaceId: ctx.workspaceId ?? undefined, agentId: ctx.agentId ?? undefined },
      })
      return SkillInventoryListSchema.parse(data) satisfies SkillInventoryEntry[]
    },
  })

  const createSkill = useMutation({
    mutationFn: async (params: {
      scope: SkillScope
      name: string
      description: string
      body: string
      frontmatter: Record<string, unknown>
    }) => {
      const { data } = await postSkills({
        body: {
          ...toIpcContext(context),
          scope: params.scope,
          name: params.name,
          description: params.description,
          body: params.body,
          frontmatter: params.frontmatter,
        },
      })
      return SkillDocumentSchema.parse(data) satisfies SkillDocument
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const updateSkill = useMutation({
    mutationFn: async (params: {
      scope: SkillScope
      currentName: string
      name: string
      description: string
      body: string
      frontmatter: Record<string, unknown>
    }) => {
      const { data } = await putSkillsDocument({
        body: {
          ...toIpcContext(context),
          scope: params.scope,
          name: params.currentName,
          document: {
            name: params.name,
            description: params.description,
            body: params.body,
            frontmatter: params.frontmatter,
          },
        },
      })
      return SkillDocumentSchema.parse(data) satisfies SkillDocument
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const deleteSkill = useMutation({
    mutationFn: async (params: { scope: SkillScope, name: string }) => {
      await deleteSkillsDocument({
        query: {
          scope: params.scope,
          name: params.name,
          workspaceId: toIpcContext(context).workspaceId ?? undefined,
          agentId: toIpcContext(context).agentId ?? undefined,
        },
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const importSkill = useMutation({
    mutationFn: async (params: { scope: SkillScope, sourceDir: string }) => {
      const { data } = await postSkillsImport({
        body: {
          ...toIpcContext(context),
          scope: params.scope,
          sourceDir: params.sourceDir,
          overwrite: false,
        },
      })
      return SkillDocumentSchema.parse(data) satisfies SkillDocument
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const exportSkill = useMutation({
    mutationFn: async (params: { scope: SkillScope, name: string, destinationDir: string }) => {
      const ctx = toIpcContext(context)
      const { data, error } = await postSkillsExport({
        body: {
          scope: params.scope,
          name: params.name,
          destinationDir: params.destinationDir,
          confirmedNonCradleOwnedWrite: true,
          overwrite: false,
          workspaceId: ctx.workspaceId ?? null,
          agentId: ctx.agentId ?? null,
        },
      })
      if (error) {
        throw new Error(String(error))
      }
      return SkillExportResponseSchema.parse(data).destinationDir
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  return {
    inventory,
    isLoading,
    isSuccess,
    createSkill,
    updateSkill,
    deleteSkill,
    importSkill,
    exportSkill,
  }
}

export function useSkillDocument(
  context: SkillQueryContext | undefined,
  scope: SkillScope | null,
  name: string | null,
) {
  return useQuery({
    queryKey: skillDocumentQueryKey(context, scope ?? 'global', name),
    queryFn: async (): Promise<SkillDocument | null> => {
      if (!scope || !name) {
        return null
      }
      const { data } = await getSkillsDocument({
        query: {
          scope,
          name,
          workspaceId: toIpcContext(context).workspaceId ?? undefined,
          agentId: toIpcContext(context).agentId ?? undefined,
        },
      })
      return data === undefined || data === null ? null : SkillDocumentSchema.parse(data) satisfies SkillDocument
    },
    enabled: !!scope && !!name,
  })
}

/**
 * Hooks to fetch skills from a remote/local source and import selected ones.
 * Operates independently of the inventory query context.
 */
export function useSkillSourceImport(context?: SkillQueryContext) {
  const queryClient = useQueryClient()

  const fetchSource = useMutation({
    mutationFn: async (source: string): Promise<{
      sessionId: string
      source: ParsedSkillSource
      skills: DiscoveredSkill[]
    }> => {
      const { data } = await postSkillsFetchSource({ body: { source } })
      return SkillFetchSourceResponseSchema.parse(data) satisfies { sessionId: string, source: ParsedSkillSource, skills: DiscoveredSkill[] }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const importFromFetch = useMutation({
    mutationFn: async (params: {
      sessionId: string
      selectedDirs: string[]
      scope: SkillScope
      overwrite?: boolean
    }): Promise<{ imported: SkillDocument[], errors: Array<{ dir: string, error: string }> }> => {
      const { data } = await postSkillsImportFromFetch({
        body: {
          ...toIpcContext(context),
          sessionId: params.sessionId,
          selectedDirs: params.selectedDirs,
          scope: params.scope,
          overwrite: params.overwrite,
        },
      })
      return SkillImportFromFetchResponseSchema.parse(data) satisfies { imported: SkillDocument[], errors: Array<{ dir: string, error: string }> }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  const cancelFetch = useMutation({
    mutationFn: async (sessionId: string): Promise<void> => {
      await postSkillsCancelFetch({ body: { sessionId } })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  })

  return { fetchSource, importFromFetch, cancelFetch }
}
