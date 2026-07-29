import { useRef } from 'react'
import { Keyboard, StyleSheet, Text, View } from 'react-native'

import type { GetWorkspacesResponse, GetWorksResponse, PostWorksData } from '@/api-gen'
import type { AppSection } from '@/components/common/app-menu-button'
import { AppMenuButton } from '@/components/common/app-menu-button'
import { CradleIconButton } from '@/components/common/cradle-icon-button'
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

type Work = GetWorksResponse[number]
type Workspace = GetWorkspacesResponse[number]

export interface WorkListViewProps {
  works: Work[]
  workspaces: Workspace[]
  isCreating?: boolean
  isRefreshing?: boolean
  onCreate: (input: PostWorksData['body']) => void
  onNavigate: (section: AppSection) => void
  onOpen: (workId: string) => void
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
  onOpenUsage,
  onRefresh,
}: WorkListViewProps) {
  const theme = useTheme()
  const composerRef = useRef<WorkComposerHandle>(null)
  const groups = ['Today', 'This week', 'Older']
    .map(title => ({ title, works: works.filter(work => workGroup(work.updatedAt) === title) }))
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
          workspaces={workspaces}
        />
      )}
      leading={<CradleIconButton onPress={onOpenUsage} />}
      onPressBackground={() => {
        composerRef.current?.collapse()
        Keyboard.dismiss()
      }}
      onRefresh={onRefresh}
      refreshing={isRefreshing}
      title="Work"
    >
      {works.length === 0
        ? (
            <EmptyState
              description="Create an isolated Work to let an agent build against a project."
              title="No active Work"
            />
          )
        : (
            <View>
              {groups.map(group => (
                <View key={group.title} style={styles.group}>
                  <SectionHeading title={group.title} />
                  {group.works.map(work => (
                    <Item
                      description={work.objective}
                      footer={(
                        <View style={styles.meta}>
                          <StatusPill label={work.activity} tone={activityTone(work.activity)} />
                          <Text style={[styles.time, { color: theme.mutedForeground }]}>{relativeTime(work.updatedAt)}</Text>
                        </View>
                      )}
                      key={work.id}
                      media={<View style={[styles.workDot, { backgroundColor: activityTone(work.activity) === 'neutral' ? theme.dimForeground : activityTone(work.activity) === 'success' ? theme.success : activityTone(work.activity) === 'danger' ? theme.destructive : theme.warning }]} />}
                      onPress={() => onOpen(work.id)}
                      title={work.title}
                    />
                  ))}
                </View>
              ))}
            </View>
          )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  group: {
    marginBottom: spacing.md,
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
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
