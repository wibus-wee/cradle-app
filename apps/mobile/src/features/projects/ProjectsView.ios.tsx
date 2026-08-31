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
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
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

import { NativeUnavailableView } from '@/components/ui/native-unavailable-view.ios'
import { Screen } from '@/components/ui/screen'
import type { WorkComposerHandle } from '@/features/work/WorkComposer'
import { WorkComposer } from '@/features/work/WorkComposer'

import type { ProjectsViewProps } from './projects-view-contract'
import { workspaceMatchesSearch } from './projects-view-model'

export type { ProjectsViewProps, WorkspaceSummary } from './projects-view-contract'

const fullWidth = frame({ maxWidth: Infinity, minHeight: 44, alignment: 'leading' })
const plainButton = buttonStyle('plain')
const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const tabularNumber = monospacedDigit()

export function ProjectsView({
  projects,
  isCreating = false,
  onCreate,
  onOpenProject,
  onRefresh,
  searchQuery,
}: ProjectsViewProps) {
  const composerRef = useRef<WorkComposerHandle>(null)
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const filteredProjects = normalizedSearch
    ? projects.filter(project => workspaceMatchesSearch(project, normalizedSearch))
    : projects
  const workspaces = projects
    .map(project => project.workspace)
    .filter(workspace => workspace.availability === 'available')
  const listModifiers = [
    listStyle('insetGrouped'),
    ...(onRefresh ? [refreshable(async () => { await onRefresh() })] : []),
  ]

  return (
    <Screen
      avoidKeyboard={workspaces.length > 0}
      footer={workspaces.length > 0
        ? (
            <WorkComposer
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
      title="Workspaces"
    >
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <List modifiers={listModifiers}>
          <Section
            footer={(
              <Text modifiers={[secondaryForeground]}>
                {`${filteredProjects.length} ${filteredProjects.length === 1 ? 'workspace' : 'workspaces'}`}
              </Text>
            )}
          >
            {filteredProjects.map(({ workspace, sessions }) => {
              const missing = workspace.availability === 'missing'
              const conversationCount = sessions.length
              return (
                <Button
                  key={workspace.id}
                  modifiers={[
                    plainButton,
                    accessibilityLabel(workspace.name),
                    accessibilityValue([
                      missing ? 'Unavailable on server' : workspace.gitIdentity.branch ?? 'No Git branch',
                      `${conversationCount} ${conversationCount === 1 ? 'conversation' : 'conversations'}`,
                      ...(workspace.pinned > 0 ? ['Pinned'] : []),
                    ].join(', ')),
                    accessibilityHint('Opens workspace'),
                  ]}
                  onPress={() => {
                    composerRef.current?.collapse()
                    Keyboard.dismiss()
                    onOpenProject(workspace.id)
                  }}
                >
                  <HStack modifiers={[fullWidth]} spacing={12}>
                    <Image
                      color={missing ? 'red' : 'blue'}
                      size={21}
                      systemName={missing ? 'folder.badge.questionmark' : 'folder.fill'}
                    />
                    <VStack alignment="leading" spacing={3}>
                      <HStack spacing={6}>
                        <Text>{workspace.name}</Text>
                        {workspace.pinned > 0 && (
                          <Image color="orange" size={12} systemName="pin.fill" />
                        )}
                      </HStack>
                      <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                        {missing
                          ? 'Unavailable on server'
                          : workspace.gitIdentity.branch ?? 'No Git branch'}
                      </Text>
                    </VStack>
                    <Spacer />
                    <HStack spacing={5}>
                      <Image color="secondary" size={14} systemName="bubble.left.and.bubble.right" />
                      <Text modifiers={[secondaryForeground, tabularNumber]}>
                        {sessions.length.toString()}
                      </Text>
                    </HStack>
                    <Image color="secondary" size={14} systemName="chevron.forward" />
                  </HStack>
                </Button>
              )
            })}
          </Section>

          {filteredProjects.length === 0 && (
            <NativeUnavailableView
              description={normalizedSearch
                ? 'Try a different workspace name, identifier, or branch.'
                : 'Add a Workspace from Cradle Desktop, then refresh this page.'}
              systemImage={normalizedSearch ? 'magnifyingglass' : 'folder'}
              title={normalizedSearch ? 'No Matching Workspaces' : 'No Workspaces Yet'}
            />
          )}
        </List>
      </Host>
    </Screen>
  )
}
