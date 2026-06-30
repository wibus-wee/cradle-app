import { FolderLine as FolderIcon } from '@mingcute/react'
import { useCallback, useMemo } from 'react'

import { WorkspaceFileIcon, WorkspaceFileIconSpriteSheet } from '~/components/common/workspace-file-icon'

import { AutocompletePanel, HighlightedAutocompleteText } from './autocomplete-panel'
import { PluginMentionIcon } from './plugin-mention-icon'

export interface MentionItem {
  kind?: 'file'
  type: 'file' | 'directory'
  name: string
  /** Relative path from workspace root */
  path: string
}

export interface PluginMentionCapability {
  id: string
  type: string
  layer: 'server' | 'web' | 'desktop'
  label: string | null
}

export interface PluginMentionItem {
  kind: 'plugin'
  provider?: 'cradle' | 'codex'
  pluginName: string
  displayName: string
  description: string | null
  iconUrl: string | null
  routeSegment: string
  capabilities: PluginMentionCapability[]
  mcpServers: string[]
  nativeMention?: { name: string, path: string } | null
  active: boolean
}

export type MentionPickerItem = MentionItem | PluginMentionItem

type MentionPanelItem = MentionPickerItem & {
  id: string
  searchText: string
}

interface MentionPanelProps {
  items: MentionPickerItem[]
  query: string
  searchItems?: (query: string, signal?: AbortSignal) => Promise<MentionPickerItem[]>
  onSelect: (item: MentionPickerItem) => void
  onTabComplete?: (item: MentionPickerItem) => void
  onClose: () => void
  visible: boolean
}

const MAX_RESULTS = 30

export function MentionPanel({ items, query, searchItems, onSelect, onTabComplete, onClose, visible }: MentionPanelProps) {
  const panelItems = useMemo(() => items.map(toMentionPanelItem), [items])
  const searchPanelItems = useCallback(async (searchQuery: string, signal?: AbortSignal) => {
    return searchItems ? (await searchItems(searchQuery, signal)).map(toMentionPanelItem) : []
  }, [searchItems])
  const handleSelect = useCallback((item: MentionPanelItem) => {
    onSelect(toMentionItem(item))
  }, [onSelect])
  const handleTabComplete = useMemo(() => {
    if (!onTabComplete) {
      return undefined
    }
    return (item: MentionPanelItem) => onTabComplete(toMentionItem(item))
  }, [onTabComplete])
  const readSectionLabel = useCallback((item: MentionPanelItem, previousItem: MentionPanelItem | null) => {
    const section = mentionSection(item)
    return previousItem && mentionSection(previousItem) === section ? null : section
  }, [])
  const readRankFields = useCallback((item: MentionPanelItem) => isPluginMentionItem(item)
    ? [
        { value: item.displayName, role: 'primary' as const },
        { value: item.pluginName, role: 'path' as const },
        { value: item.description ?? '', role: 'secondary' as const },
      ]
    : [
        { value: item.name, role: 'primary' as const },
        { value: item.path, role: 'path' as const },
      ], [])
  const renderMentionItem = useCallback(({ item, positions }: {
    item: MentionPanelItem
    positions: Set<number>
  }) => <MentionPanelRow item={item} positions={positions} />, [])

  return (
    <>
      <WorkspaceFileIconSpriteSheet />
      <AutocompletePanel
        items={panelItems}
        query={query}
        searchItems={searchItems ? searchPanelItems : undefined}
        onSelect={handleSelect}
        onTabComplete={handleTabComplete}
        onClose={onClose}
        visible={visible}
        maxResults={MAX_RESULTS}
        emptyLogLabel="mentions"
        sectionLabel={readSectionLabel}
        rankFields={readRankFields}
        renderItem={renderMentionItem}
      />
    </>
  )
}

function isPluginMentionItem(item: MentionPickerItem): item is PluginMentionItem {
  return item.kind === 'plugin'
}

function toMentionPanelItem(item: MentionPickerItem): MentionPanelItem {
  if (isPluginMentionItem(item)) {
    const provider = item.provider ?? 'cradle'
    return {
      ...item,
      provider,
      id: `plugin:${provider}:${item.pluginName}`,
      searchText: `${provider} ${item.displayName} ${item.pluginName} ${item.nativeMention?.path ?? ''} ${item.description ?? ''} ${item.capabilities.map(capability => capability.type).join(' ')}`,
    }
  }
  return {
    ...item,
    kind: 'file',
    id: item.path,
    searchText: item.path,
  }
}

function toMentionItem(item: MentionPanelItem): MentionPickerItem {
  if (isPluginMentionItem(item)) {
    return {
      kind: 'plugin',
      provider: item.provider ?? 'cradle',
      pluginName: item.pluginName,
      displayName: item.displayName,
      description: item.description,
      iconUrl: item.iconUrl,
      routeSegment: item.routeSegment,
      capabilities: item.capabilities,
      mcpServers: item.mcpServers,
      nativeMention: item.nativeMention ?? null,
      active: item.active,
    }
  }
  return {
    kind: 'file',
    type: item.type,
    name: item.name,
    path: item.path,
  }
}

function mentionSection(item: MentionPanelItem): 'Plugins' | 'Files' {
  return isPluginMentionItem(item) ? 'Plugins' : 'Files'
}

function MentionPanelRow({ item, positions }: { item: MentionPanelItem, positions: Set<number> }) {
  if (isPluginMentionItem(item)) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        <PluginMentionIcon iconUrl={item.iconUrl} />
        <span className="min-w-0 flex-1 truncate font-medium">
          <HighlightedAutocompleteText text={item.displayName} positions={positions} />
        </span>
      </span>
    )
  }

  return (
    <>
      {item.type === 'directory'
        ? <FolderIcon className="size-3.5 shrink-0 !text-muted-foreground/60" aria-hidden="true" />
        : <WorkspaceFileIcon path={item.path} className="size-3.5 text-muted-foreground/60" />}
      <span className="min-w-0 truncate">
        <HighlightedAutocompleteText text={item.path} positions={positions} />
      </span>
    </>
  )
}
