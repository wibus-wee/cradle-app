import { SegmentedControl } from '@expo/ui/community/segmented-control'
import { Info, Search } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { Keyboard, SectionList, StyleSheet, Text, View } from 'react-native'

import type { GetWorkspacesResponse, GetWorksResponse, PostWorksData } from '@/api-gen'
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
  archivedWorks: Work[]
  workspaces: Workspace[]
  isCreating?: boolean
  isRefreshing?: boolean
  onCreate: (input: PostWorksData['body']) => void
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
  archivedWorks,
  workspaces,
  isCreating = false,
  isRefreshing = false,
  onCreate,
  onOpen,
  onOpenInfo,
  onOpenUsage,
  onRefresh,
}: WorkListViewProps) {
  const theme = useTheme()
  const composerRef = useRef<WorkComposerHandle>(null)
  const [search, setSearch] = useState('')
  const [lifecycle, setLifecycle] = useState<'active' | 'archived'>('active')
  const [mode, setMode] = useState<'all' | 'running' | 'attention'>('all')
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const visibleWorks = lifecycle === 'active' ? works : archivedWorks
  const searchedWorks = normalizedSearch
    ? visibleWorks.filter((work) => {
        const workspaceName = workspaces.find(workspace => workspace.id === work.workspaceId)?.name
        return [work.title, work.objective, workspaceName]
          .some(value => value?.toLocaleLowerCase().includes(normalizedSearch))
      })
    : visibleWorks
  const filteredWorks = searchedWorks.filter((work) => {
    if (lifecycle === 'archived') { return true }
    if (mode === 'running') { return work.activity === 'running' }
    if (mode === 'attention') { return work.activity === 'waiting' || work.activity === 'blocked' }
    return true
  })
  const groups = ['Today', 'This week', 'Older']
    .map(title => ({
      title,
      works: filteredWorks.filter(work => workGroup(work.updatedAt) === title),
    }))
    .filter(group => group.works.length > 0)

  return (
    <Screen
      avoidKeyboard
      footer={lifecycle === 'active'
        ? (
            <WorkComposer
              isCreating={isCreating}
              onCreate={onCreate}
              ref={composerRef}
              showWorkType
              workspaces={workspaces}
            />
          )
        : undefined}
      leading={<CradleIconButton onPress={onOpenUsage} />}
      nativeHeader
      onPressBackground={() => {
        composerRef.current?.collapse()
        Keyboard.dismiss()
      }}
      scroll={false}
      title="Work"
    >
      <SegmentedControl
        appearance={theme.isDark ? 'dark' : 'light'}
        onValueChange={value => setLifecycle(value === 'Archived' ? 'archived' : 'active')}
        selectedIndex={lifecycle === 'active' ? 0 : 1}
        style={styles.segmented}
        values={['Active', 'Archived']}
      />
      {lifecycle === 'active' && (
        <SegmentedControl
          appearance={theme.isDark ? 'dark' : 'light'}
          onValueChange={(value) => {
            setMode(value === 'Running' ? 'running' : value === 'Attention' ? 'attention' : 'all')
          }}
          selectedIndex={mode === 'all' ? 0 : mode === 'running' ? 1 : 2}
          style={styles.segmented}
          values={['All', 'Running', 'Attention']}
        />
      )}
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
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <EmptyState
            description={normalizedSearch
              ? 'Try a different title, objective, or workspace.'
              : lifecycle === 'archived'
                ? 'Archived Work will appear here.'
                : mode === 'running'
                ? 'Active runs will appear here.'
                : mode === 'attention'
                  ? 'Waiting and blocked Work will appear here.'
                  : 'Create an isolated Work to let an agent build against a project.'}
            title={normalizedSearch
              ? 'No matching Work'
              : lifecycle === 'archived'
                ? 'No archived Work'
                : mode === 'running'
                ? 'Nothing running'
                : mode === 'attention'
                  ? 'Nothing needs attention'
                  : 'No active Work'}
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
                <StatusPill
                  label={lifecycle === 'archived' ? 'archived' : work.activity}
                  tone={lifecycle === 'archived' ? 'neutral' : activityTone(work.activity)}
                />
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
  segmented: {
    marginBottom: spacing.sm,
    minHeight: 36,
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
