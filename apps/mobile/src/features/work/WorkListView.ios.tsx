import {
  Button,
  Host,
  HStack,
  Image,
  List,
  Picker,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  listStyle,
  monospacedDigit,
  pickerStyle,
  refreshable,
  tag,
} from '@expo/ui/swift-ui/modifiers'
import { useRef, useState } from 'react'
import { Keyboard } from 'react-native'

import { CradleIconButton } from '@/components/common/cradle-icon-button'
import { NativeUnavailableView } from '@/components/ui/native-unavailable-view.ios'
import { Screen } from '@/components/ui/screen'
import { relativeTime } from '@/lib/format'

import { workGroup, workGroupTitles, workMatchesSearch } from './work-list-model'
import type { WorkListItem, WorkListViewProps } from './work-list-view-contract'
import type { WorkComposerHandle } from './WorkComposer'
import { WorkComposer } from './WorkComposer'

export type { WorkListViewProps } from './work-list-view-contract'

type WorkLifecycle = 'active' | 'archived'
type WorkMode = 'all' | 'running' | 'attention'

const fullWidth = frame({ maxWidth: Infinity, minHeight: 44, alignment: 'leading' })
const infoTarget = frame({ height: 44, width: 44 })
const plainButton = buttonStyle('plain')
const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const tabularNumber = monospacedDigit()

function activityPresentation(activity: WorkListItem['activity'], archived: boolean) {
  if (archived) {
    return { color: 'secondary' as const, label: 'Archived', symbol: 'archivebox.fill' as const }
  }
  if (activity === 'running') {
    return { color: 'green' as const, label: 'Running', symbol: 'play.circle.fill' as const }
  }
  if (activity === 'waiting') {
    return { color: 'orange' as const, label: 'Waiting', symbol: 'clock.fill' as const }
  }
  if (activity === 'blocked') {
    return { color: 'red' as const, label: 'Blocked', symbol: 'exclamationmark.triangle.fill' as const }
  }
  return { color: 'secondary' as const, label: 'Idle', symbol: 'circle.fill' as const }
}

export function WorkListView({
  works,
  archivedWorks,
  workspaces,
  isCreating = false,
  onCreate,
  onOpen,
  onOpenInfo,
  onOpenUsage,
  onRefresh,
  searchQuery,
}: WorkListViewProps) {
  const composerRef = useRef<WorkComposerHandle>(null)
  const [lifecycle, setLifecycle] = useState<WorkLifecycle>('active')
  const [mode, setMode] = useState<WorkMode>('all')
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const visibleWorks = lifecycle === 'active' ? works : archivedWorks
  const searchedWorks = normalizedSearch
    ? visibleWorks.filter(work => workMatchesSearch(work, workspaces, normalizedSearch))
    : visibleWorks
  const filteredWorks = searchedWorks.filter((work) => {
    if (lifecycle === 'archived' || mode === 'all') { return true }
    if (mode === 'running') { return work.activity === 'running' }
    return work.activity === 'waiting' || work.activity === 'blocked'
  })
  const groups = workGroupTitles
    .map(title => ({ title, works: filteredWorks.filter(work => workGroup(work.updatedAt) === title) }))
    .filter(group => group.works.length > 0)
  const listModifiers = [
    listStyle('insetGrouped'),
    ...(onRefresh ? [refreshable(async () => { await onRefresh() })] : []),
  ]

  const dismissComposer = () => {
    composerRef.current?.collapse()
    Keyboard.dismiss()
  }

  return (
    <Screen
      avoidKeyboard={lifecycle === 'active' && workspaces.length > 0}
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
      fullBleed
      leading={<CradleIconButton onPress={onOpenUsage} />}
      nativeHeader
      scroll={false}
      title="Work"
    >
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <List modifiers={listModifiers}>
          <Section>
            <Picker<WorkLifecycle>
              modifiers={[pickerStyle('segmented')]}
              onSelectionChange={(selection) => {
                dismissComposer()
                setLifecycle(selection)
              }}
              selection={lifecycle}
            >
              <Text modifiers={[tag('active')]}>Active</Text>
              <Text modifiers={[tag('archived')]}>Archived</Text>
            </Picker>
            {lifecycle === 'active' && (
              <Picker<WorkMode>
                modifiers={[pickerStyle('segmented')]}
                onSelectionChange={(selection) => {
                  dismissComposer()
                  setMode(selection)
                }}
                selection={mode}
              >
                <Text modifiers={[tag('all')]}>All</Text>
                <Text modifiers={[tag('running')]}>Running</Text>
                <Text modifiers={[tag('attention')]}>Attention</Text>
              </Picker>
            )}
          </Section>

          {groups.map(group => (
            <Section key={group.title} title={group.title}>
              {group.works.map((work) => {
                const activity = activityPresentation(work.activity, lifecycle === 'archived')
                const workspaceName = workspaces.find(workspace => workspace.id === work.workspaceId)?.name
                return (
                  <HStack key={work.id} modifiers={[fullWidth]} spacing={4}>
                    <Button
                      modifiers={[plainButton, fullWidth]}
                      onPress={() => {
                        dismissComposer()
                        onOpen(work.primarySessionId)
                      }}
                    >
                      <HStack modifiers={[fullWidth]} spacing={12}>
                        <Image color={activity.color} size={18} systemName={activity.symbol} />
                        <VStack alignment="leading" spacing={4}>
                          <Text>{work.title}</Text>
                          <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                            {work.objective}
                          </Text>
                          <HStack spacing={7}>
                            <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(activity.color)]}>
                              {activity.label}
                            </Text>
                            {workspaceName && (
                              <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                                {workspaceName}
                              </Text>
                            )}
                            <Text
                              modifiers={[
                                font({ textStyle: 'caption' }),
                                secondaryForeground,
                                tabularNumber,
                              ]}
                            >
                              {relativeTime(work.updatedAt)}
                            </Text>
                          </HStack>
                        </VStack>
                        <Spacer />
                      </HStack>
                    </Button>
                    <Button
                      modifiers={[
                        plainButton,
                        infoTarget,
                        accessibilityLabel(`Open info for ${work.title}`),
                      ]}
                      onPress={() => {
                        dismissComposer()
                        onOpenInfo(work.id)
                      }}
                    >
                      <Image color="secondary" size={18} systemName="info.circle" />
                    </Button>
                  </HStack>
                )
              })}
            </Section>
          ))}

          {filteredWorks.length === 0 && (
            <NativeUnavailableView
              description={normalizedSearch
                ? 'Try a different title, objective, or workspace.'
                : lifecycle === 'archived'
                  ? 'Archived Work will appear here.'
                  : mode === 'running'
                    ? 'Active runs will appear here.'
                    : mode === 'attention'
                      ? 'Waiting and blocked Work will appear here.'
                      : 'Create an isolated Work to let an agent build against a project.'}
              systemImage={normalizedSearch
                ? 'magnifyingglass'
                : lifecycle === 'archived'
                  ? 'archivebox'
                  : mode === 'running'
                    ? 'play.circle'
                    : mode === 'attention'
                      ? 'exclamationmark.triangle'
                      : 'hammer'}
              title={normalizedSearch
                ? 'No Matching Work'
                : lifecycle === 'archived'
                  ? 'No Archived Work'
                  : mode === 'running'
                    ? 'Nothing Running'
                    : mode === 'attention'
                      ? 'Nothing Needs Attention'
                      : 'No Active Work'}
            />
          )}
        </List>
      </Host>
    </Screen>
  )
}
