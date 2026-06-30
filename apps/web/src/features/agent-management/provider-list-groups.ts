import type { AgentProfile } from '~/features/agent-runtime/types'

import type {
  ExternalProviderRecordView,
  ExternalProviderSourceView,
  ProviderListEntry,
} from './provider-settings-utils'
import {
  createExternalProviderListEntry,
  createManualProviderListEntry,
} from './provider-settings-utils'

export interface ProviderListGroup {
  id: string
  label: string
  kind: 'external-plugin' | 'external-source' | 'manual'
  entries: ProviderListEntry[]
}

const MANUAL_GROUP_ID = 'manual'
const MANUAL_GROUP_LABEL = 'Manual providers'
const UNKNOWN_EXTERNAL_SOURCE_LABEL = 'External source'
const CC_SWITCH_SOURCE_ID = 'cc-switch'
const CC_SWITCH_GROUP_LABEL = 'CC-Switch'

function compareProviderProfiles(a: AgentProfile, b: AgentProfile): number {
  if (a.enabled !== b.enabled) {
    return a.enabled ? -1 : 1
  }

  return (
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    || a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' })
  )
}

function compareProviderGroups(a: ProviderListGroup, b: ProviderListGroup): number {
  if (a.kind === 'manual' || b.kind === 'manual') {
    if (a.kind === b.kind) {
      return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
    }
    return a.kind === 'manual' ? -1 : 1
  }

  const aHasEnabled = entriesEnabled(a)
  const bHasEnabled = entriesEnabled(b)
  if (aHasEnabled !== bHasEnabled) {
    return aHasEnabled ? -1 : 1
  }

  if (a.kind !== b.kind) {
    const order: Record<ProviderListGroup['kind'], number> = {
      'manual': 0,
      'external-plugin': 1,
      'external-source': 2,
    }
    return order[a.kind] - order[b.kind]
  }

  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
}

const EXTERNAL_STATUS_ORDER: Record<ExternalProviderRecordView['status'], number> = {
  active: 0,
  stale: 1,
  unsupported: 2,
  error: 3,
  missing: 4,
}

function compareExternalRecords(
  a: ExternalProviderRecordView,
  b: ExternalProviderRecordView,
): number {
  const aIsActive = a.status === 'active' && a.runtimeTargetEnabled
  const bIsActive = b.status === 'active' && b.runtimeTargetEnabled
  if (aIsActive !== bIsActive) {
    return aIsActive ? -1 : 1
  }

  return (
    EXTERNAL_STATUS_ORDER[a.status] - EXTERNAL_STATUS_ORDER[b.status]
    || Number(b.runtimeTargetEnabled) - Number(a.runtimeTargetEnabled)
    || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    || a.externalId.localeCompare(b.externalId, undefined, { numeric: true, sensitivity: 'base' })
  )
}

function entriesEnabled(group: ProviderListGroup): boolean {
  return group.entries.some((entry) => {
    if (entry.kind === 'manual') {
      return entry.profile.enabled
    }
    return entry.record.status === 'active' && entry.record.runtimeTargetEnabled
  })
}

function manualGroupDescriptor(): Pick<ProviderListGroup, 'id' | 'kind' | 'label'> {
  return { id: MANUAL_GROUP_ID, kind: 'manual', label: MANUAL_GROUP_LABEL }
}

function externalGroupDescriptor(
  record: ExternalProviderRecordView,
  sourceById: Map<string, ExternalProviderSourceView>,
): Pick<ProviderListGroup, 'id' | 'kind' | 'label'> {
  const source = sourceById.get(record.sourceKey)
  if (!source) {
    return {
      id: `external-source:${record.sourceKey}`,
      kind: 'external-source',
      label: UNKNOWN_EXTERNAL_SOURCE_LABEL,
    }
  }

  return {
    id: `external-plugin:${source.pluginName}`,
    kind: 'external-plugin',
    label: source.sourceId === CC_SWITCH_SOURCE_ID
      ? CC_SWITCH_GROUP_LABEL
      : source.label.trim() || source.pluginName,
  }
}

export function sortProviderProfilesByStatus(profiles: AgentProfile[]): AgentProfile[] {
  return [...profiles].sort(compareProviderProfiles)
}

export function collectProviderListGroups(
  profiles: AgentProfile[] = [],
  externalRecords: ExternalProviderRecordView[] = [],
  externalSources: ExternalProviderSourceView[] = [],
): ProviderListGroup[] {
  const sourceById = new Map(externalSources.map(source => [source.id, source]))
  const groups = new Map<string, ProviderListGroup>()

  for (const profile of sortProviderProfilesByStatus(profiles)) {
    const descriptor = manualGroupDescriptor()
    const group = groups.get(descriptor.id)
    if (group) {
      group.entries.push(createManualProviderListEntry(profile))
      continue
    }

    groups.set(descriptor.id, {
      ...descriptor,
      entries: [createManualProviderListEntry(profile)],
    })
  }

  for (const record of [...externalRecords].sort(compareExternalRecords)) {
    const descriptor = externalGroupDescriptor(record, sourceById)
    const group = groups.get(descriptor.id)
    if (group) {
      group.entries.push(createExternalProviderListEntry(record))
      continue
    }

    groups.set(descriptor.id, {
      ...descriptor,
      entries: [createExternalProviderListEntry(record)],
    })
  }

  return Array.from(groups.values()).sort(compareProviderGroups)
}
