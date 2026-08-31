import {
  Button,
  Host,
  HStack,
  Image,
  List,
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
  refreshable,
} from '@expo/ui/swift-ui/modifiers'
import { useRef } from 'react'
import { Keyboard } from 'react-native'

import { Screen } from '@/components/ui/screen'
import type { WorkComposerHandle } from '@/features/work/WorkComposer'
import { WorkComposer } from '@/features/work/WorkComposer'
import { relativeTime } from '@/lib/format'

import type {
  WorkspaceSession,
  WorkspaceViewProps,
  WorkspaceWork,
} from './workspace-view-contract'

export type { WorkspaceViewProps } from './workspace-view-contract'

const fullWidth = frame({ maxWidth: Infinity, minHeight: 44, alignment: 'leading' })
const infoTarget = frame({ height: 44, width: 44 })
const plainButton = buttonStyle('plain')
const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const tabularNumber = monospacedDigit()

function workPresentation(activity: WorkspaceWork['activity']) {
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

function sessionPresentation(status: WorkspaceSession['status']) {
  if (status === 'streaming') {
    return { color: 'green' as const, label: 'Streaming', symbol: 'wave.3.right.circle.fill' as const }
  }
  if (status === 'error') {
    return { color: 'red' as const, label: 'Error', symbol: 'exclamationmark.circle.fill' as const }
  }
  return { color: 'secondary' as const, label: 'Idle', symbol: 'bubble.left.fill' as const }
}

export function WorkspaceView({
  workspace,
  workspaces,
  sessions,
  works,
  files,
  isCreating = false,
  onBrowseFiles,
  onCreate,
  onOpenFile,
  onOpenSession,
  onOpenWork,
  onOpenWorkInfo,
  onRefresh,
}: WorkspaceViewProps) {
  const composerRef = useRef<WorkComposerHandle>(null)
  const canCreateWork = workspaces.some(candidate => candidate.id === workspace.id)
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
      avoidKeyboard={canCreateWork}
      footer={canCreateWork
        ? (
            <WorkComposer
              initialWorkspaceId={workspace.id}
              isCreating={isCreating}
              onCreate={onCreate}
              ref={composerRef}
              showWorkType={false}
              workspaces={workspaces}
            />
          )
        : undefined}
      fullBleed
      nativeHeader
      scroll={false}
      title={workspace.name}
    >
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <List modifiers={listModifiers}>
          <Section title="Workspace">
            <HStack modifiers={[fullWidth]} spacing={12}>
              <Image color="secondary" size={18} systemName="arrow.triangle.branch" />
              <VStack alignment="leading" spacing={3}>
                <Text>Branch</Text>
                <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                  {workspace.gitIdentity.branch ?? 'No Git branch'}
                </Text>
              </VStack>
              <Spacer />
              {workspace.pinned > 0 && <Image color="orange" size={14} systemName="pin.fill" />}
            </HStack>
            <HStack modifiers={[fullWidth]} spacing={12}>
              <Image color="secondary" size={18} systemName="folder" />
              <VStack alignment="leading" spacing={3}>
                <Text>Location</Text>
                <Text
                  modifiers={[
                    font({ design: 'monospaced', textStyle: 'caption' }),
                    secondaryForeground,
                  ]}
                >
                  {workspace.locator.path}
                </Text>
              </VStack>
            </HStack>
            <HStack modifiers={[fullWidth]} spacing={12}>
              <Image
                color={workspace.availability === 'available' ? 'green' : 'red'}
                size={18}
                systemName={workspace.availability === 'available'
                  ? 'checkmark.circle.fill'
                  : 'exclamationmark.circle.fill'}
              />
              <Text>Server Availability</Text>
              <Spacer />
              <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                {workspace.availability === 'available' ? 'Available' : 'Unavailable'}
              </Text>
            </HStack>
          </Section>

          {works.length > 0 && (
            <Section
              footer={<Text modifiers={[secondaryForeground]}>{`${works.length} active`}</Text>}
              title="Work"
            >
              {works.map((work) => {
                const activity = workPresentation(work.activity)
                return (
                  <HStack key={work.id} modifiers={[fullWidth]} spacing={4}>
                    <Button
                      modifiers={[plainButton, fullWidth]}
                      onPress={() => {
                        dismissComposer()
                        onOpenWork(work.primarySessionId)
                      }}
                    >
                      <HStack modifiers={[fullWidth]} spacing={12}>
                        <Image color={activity.color} size={18} systemName={activity.symbol} />
                        <VStack alignment="leading" spacing={4}>
                          <Text>{work.title}</Text>
                          <HStack spacing={7}>
                            <Text
                              modifiers={[
                                font({ textStyle: 'caption' }),
                                foregroundStyle(activity.color),
                              ]}
                            >
                              {activity.label}
                            </Text>
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
                        onOpenWorkInfo(work.id)
                      }}
                    >
                      <Image color="secondary" size={18} systemName="info.circle" />
                    </Button>
                  </HStack>
                )
              })}
            </Section>
          )}

          <Section
            footer={<Text modifiers={[secondaryForeground]}>{`${sessions.length} conversations`}</Text>}
            title="Conversations"
          >
            {sessions.length === 0
              ? (
                  <HStack modifiers={[fullWidth]} spacing={12}>
                    <Image color="secondary" size={18} systemName="bubble.left" />
                    <VStack alignment="leading" spacing={3}>
                      <Text>No Conversations</Text>
                      <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                        Start one from Cradle Desktop or create Work below.
                      </Text>
                    </VStack>
                  </HStack>
                )
              : sessions.map((session) => {
                  const status = sessionPresentation(session.status)
                  return (
                    <Button
                      key={session.id}
                      modifiers={[plainButton]}
                      onPress={() => {
                        dismissComposer()
                        onOpenSession(session.id)
                      }}
                    >
                      <HStack modifiers={[fullWidth]} spacing={12}>
                        <Image color={status.color} size={18} systemName={status.symbol} />
                        <VStack alignment="leading" spacing={4}>
                          <Text>{session.title ?? 'Untitled conversation'}</Text>
                          <HStack spacing={7}>
                            <Text
                              modifiers={[
                                font({ textStyle: 'caption' }),
                                foregroundStyle(status.color),
                              ]}
                            >
                              {status.label}
                            </Text>
                            <Text
                              modifiers={[
                                font({ textStyle: 'caption' }),
                                secondaryForeground,
                                tabularNumber,
                              ]}
                            >
                              {relativeTime(
                                session.latestAssistantMessageAt
                                ?? session.latestUserMessageAt
                                ?? session.updatedAt,
                              )}
                            </Text>
                          </HStack>
                        </VStack>
                        <Spacer />
                        <Image color="secondary" size={14} systemName="chevron.forward" />
                      </HStack>
                    </Button>
                  )
                })}
          </Section>

          {files.length > 0 && (
            <Section
              footer={<Text modifiers={[secondaryForeground]}>{`${files.length} top-level entries`}</Text>}
              title="Files"
            >
              <Button
                modifiers={[plainButton]}
                onPress={() => {
                  dismissComposer()
                  onBrowseFiles()
                }}
              >
                <HStack modifiers={[fullWidth]} spacing={12}>
                  <Image color="blue" size={18} systemName="folder" />
                  <Text>Browse All Files</Text>
                  <Spacer />
                  <Image color="secondary" size={14} systemName="chevron.forward" />
                </HStack>
              </Button>
              {files.slice(0, 12).map(entry => (
                <Button
                  key={entry.path}
                  modifiers={[plainButton]}
                  onPress={() => {
                    dismissComposer()
                    onOpenFile(entry)
                  }}
                >
                  <HStack modifiers={[fullWidth]} spacing={12}>
                    <Image
                      color={entry.type === 'directory' ? 'blue' : 'secondary'}
                      size={17}
                      systemName={entry.type === 'directory' ? 'folder.fill' : 'doc.text'}
                    />
                    <Text>{entry.name}</Text>
                    <Spacer />
                    {entry.type === 'directory' && (
                      <Image color="secondary" size={14} systemName="chevron.forward" />
                    )}
                  </HStack>
                </Button>
              ))}
            </Section>
          )}
        </List>
      </Host>
    </Screen>
  )
}
