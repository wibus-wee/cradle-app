import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'

export type StatusCategory = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export interface ViewConfig {
  layout: 'board' | 'list'
  groupBy: 'status' | 'priority' | 'milestone' | 'assignee' | 'label'
  orderBy: 'manual' | 'priority' | 'created' | 'updated' | 'status'
  orderDirection: 'asc' | 'desc'
  showEmptyGroups: boolean
  displayProperties: {
    id: boolean
    priority: boolean
    status: boolean
    labels: boolean
    assignee: boolean
    subIssueProgress: boolean
    agentIndicator: boolean
    milestone: boolean
    dueDate: boolean
    createdAt: boolean
  }
}

export interface FilterState {
  statusIds?: string[]
  priorities?: ('none' | 'low' | 'medium' | 'high' | 'urgent')[]
  labels?: string[]
  milestoneId?: string | null
  isDelegated?: boolean | null
}

const defaultDisplayProperties: ViewConfig['displayProperties'] = {
  id: true,
  priority: true,
  status: false,
  labels: true,
  assignee: true,
  subIssueProgress: false,
  agentIndicator: true,
  milestone: false,
  dueDate: false,
  createdAt: false,
}

const defaultConfig: ViewConfig = {
  layout: 'board',
  groupBy: 'status',
  orderBy: 'manual',
  orderDirection: 'asc',
  showEmptyGroups: true,
  displayProperties: defaultDisplayProperties,
}

const ViewConfigSchema = z.object({
  layout: z.enum(['board', 'list']).catch('board').default('board'),
  groupBy: z.enum(['status', 'priority', 'milestone', 'assignee', 'label']).default('status'),
  orderBy: z.enum(['manual', 'priority', 'created', 'updated', 'status']).default('manual'),
  orderDirection: z.enum(['asc', 'desc']).default('asc'),
  showEmptyGroups: z.boolean().default(true),
  displayProperties: z.object({
    id: z.boolean().default(true),
    priority: z.boolean().default(true),
    status: z.boolean().default(false),
    labels: z.boolean().default(true),
    assignee: z.boolean().default(true),
    subIssueProgress: z.boolean().default(false),
    agentIndicator: z.boolean().default(true),
    milestone: z.boolean().default(false),
    dueDate: z.boolean().default(false),
    createdAt: z.boolean().default(false),
  }).default(defaultDisplayProperties),
}).default(defaultConfig)
const ViewConfigStorageSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)).pipe(ViewConfigSchema),
  z.null().transform(() => ViewConfigSchema.parse(undefined)),
])

const FilterStateSchema = z.object({
  statusIds: z.array(z.string()).optional(),
  priorities: z.array(z.enum(['none', 'low', 'medium', 'high', 'urgent'])).optional(),
  labels: z.array(z.string()).optional(),
  milestoneId: z.string().nullable().optional(),
  isDelegated: z.boolean().nullable().optional(),
}).default({})
const FilterStateStorageSchema = z.union([
  z.string().transform(raw => JSON.parse(raw)).pipe(FilterStateSchema),
  z.null().transform(() => FilterStateSchema.parse(undefined)),
])

const defaultFilter = FilterStateSchema.parse(undefined) as FilterState

function normalizeConfig(config: ViewConfig): ViewConfig {
  return {
    ...defaultConfig,
    ...config,
    displayProperties: {
      ...defaultConfig.displayProperties,
      ...(config.displayProperties ?? {}),
    },
  }
}

export function useViewConfig(workspaceId: string) {
  const configKey = `kanban-view-config-${workspaceId}`
  const filterKey = `kanban-view-filter-${workspaceId}`

  const [viewConfig, setViewConfig] = useState<ViewConfig>(() => {
    return normalizeConfig(ViewConfigStorageSchema.parse(localStorage.getItem(configKey)) as ViewConfig)
  })
  const [viewFilter, setViewFilter] = useState<FilterState>(() => {
    return FilterStateStorageSchema.parse(localStorage.getItem(filterKey)) as FilterState
  })

  useEffect(() => {
    localStorage.setItem(configKey, JSON.stringify(viewConfig))
  }, [viewConfig, configKey])

  useEffect(() => {
    localStorage.setItem(filterKey, JSON.stringify(viewFilter))
  }, [viewFilter, filterKey])

  const setConfig = useCallback((patch: Partial<ViewConfig>) => {
    setViewConfig(prev => normalizeConfig({
      ...prev,
      ...patch,
      displayProperties: patch.displayProperties
        ? { ...prev.displayProperties, ...patch.displayProperties }
        : prev.displayProperties,
    }))
  }, [])

  const setFilter = useCallback((patch: Partial<FilterState>) => {
    setViewFilter(prev => ({ ...prev, ...patch }))
  }, [])

  const resetFilter = useCallback(() => {
    setViewFilter(defaultFilter)
  }, [])

  return { config: viewConfig, setConfig, filter: viewFilter, setFilter, resetFilter }
}
