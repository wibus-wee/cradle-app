import { Info, Search } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { Keyboard, SectionList, StyleSheet, Text, View } from 'react-native'

import type { GetWorkspacesResponse, GetWorksResponse, PostWorksData } from '@/api-gen'
import type { AppSection } from '@/components/common/app-menu-button'
import { AppMenuButton } from '@/components/common/app-menu-button'
import { CradleIconButton } from '@/components/common/cradle-icon-button'
import { IconButton } from '@/components/ui/icon-button'
import { InputGroup } from '@/components/ui/input-group'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { EmptyState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status-pill'
import { relativeTime } from '@/lib/format'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import type { WorkComposerHandle } from './WorkComposer'
import { WorkComposer } from './WorkComposer'

type Work = GetWorksResponse['items'][number]
type Workspace = GetWorkspacesResponse[number]

export interface WorkListViewProps {
  works: Work[]
  workspaces: Workspace[]
  isCreating?: boolean
  isRefreshing?: boolean
  onCreate: (input: PostWorksData['body']) => void
  onNavigate: (section: AppSection) => void
  onOpen: (sessionId: string) => void
  onOpenInfo: (workId: string) => void
  onOpenUsage: () => void
  onRefresh?: () => void
}

function activityTone(activity: Work['activity']) {
  if (activity === 'running') { return 'success' as const }
  if (activity === 'waiting') { return 'warning' as const }
  if (activity === 'blocked') { return 'danger' as const }
  return 'neutral' as const
}

function workGroup(updatedAt: number) {
  const timestamp = updatedAt < 10_000_000_000 ? updatedAt * 1_000 : updatedAt
  const age = Date.now() - timestamp
  if (age < 86_400_000) { return 'Today' }
  if (age < 604_800_000) { return 'This week' }
  return 'Older'
}

export function WorkListView({
  works,
  workspaces,
  isCreating = false,
  isRefreshing = false,
  onCreate,
  onNavigate,
  onOpen,
  onOpenInfo,
  onOpenUsage,
  onRefresh,
}: WorkListViewProps) {
  const theme = useTheme()
  const composerRef = useRef<WorkComposerHandle>(null)
  const [search, setSearch] = useState('')
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredWorks = normalizedSearch
    ? works.filter((work) => {
        const workspaceName = workspaces.find(workspace => workspace.id === work.workspaceId)?.name
        return [work.title, work.objective, workspaceName]
          .some(value => value?.toLocaleLowerCase().includes(normalizedSearch))
      })
    : works
  const groups = ['Today', 'This week', 'Older']
    .map(title => ({
      title,
      works: filteredWorks.filter(work => workGroup(work.updatedAt) === title),
    }))
    .filter(group => group.works.length > 0)

  return (
    <Screen
      avoidKeyboard
      action={<AppMenuButton current="work" onSelect={onNavigate} />}
      footer={(
        <WorkComposer
          isCreating={isCreating}
          onCreate={onCreate}
          ref={composerRef}
          showWorkType
          workspaces={workspaces}
        />
      )}
      leading={<CradleIconButton onPress={onOpenUsage} />}
      onPressBackground={() => {
        composerRef.current?.collapse()
        Keyboard.dismiss()
      }}
      scroll={false}
      title="Work"
    >
      <View style={styles.search}>
        <InputGroup
          addon={<Search color={theme.mutedForeground} size={17} />}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          onChangeText={setSearch}
          placeholder="Search Work"
          returnKeyType="search"
          value={search}
        />
      </View>
      <SectionList
        contentContainerStyle={filteredWorks.length === 0 ? styles.emptyList : undefined}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <EmptyState
            description={normalizedSearch
              ? 'Try a different title, objective, or workspace.'
              : 'Create an isolated Work to let an agent build against a project.'}
            title={normalizedSearch ? 'No matching Work' : 'No active Work'}
          />
        )}
        onRefresh={onRefresh}
        refreshing={isRefreshing}
        renderSectionHeader={({ section }) => <SectionHeading title={section.title} />}
        renderItem={({ item: work }) => (
          <Item
            description={work.objective}
            footer={(
              <View style={styles.meta}>
                <StatusPill label={work.activity} tone={activityTone(work.activity)} />
                <Text style={[styles.time, { color: theme.mutedForeground }]}>{relativeTime(work.updatedAt)}</Text>
              </View>
            )}
            media={<View style={[styles.workDot, { backgroundColor: activityTone(work.activity) === 'neutral' ? theme.dimForeground : activityTone(work.activity) === 'success' ? theme.success : activityTone(work.activity) === 'danger' ? theme.destructive : theme.warning }]} />}
            onPress={() => onOpen(work.primarySessionId)}
            actions={(
              <IconButton
                accessibilityLabel={`Open info for ${work.title}`}
                icon={Info}
                onPress={() => onOpenInfo(work.id)}
                stopPropagation
              />
            )}
            title={work.title}
          />
        )}
        sections={groups.map(group => ({ title: group.title, data: group.works }))}
        stickySectionHeadersEnabled={false}
        style={styles.list}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  emptyList: {
    flexGrow: 1,
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  list: {
    flex: 1,
    marginBottom: spacing.md,
  },
  search: {
    marginBottom: spacing.md,
  },
  time: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  workDot: {
    borderRadius: 4,
    height: 8,
    marginTop: 5,
    width: 8,
  },
})
