import {
  Button,
  ContentUnavailableView,
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
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  listStyle,
  refreshable,
  textSelection,
} from '@expo/ui/swift-ui/modifiers'

import {
  workspaceFilePreviewUnavailableDescription,
  workspaceFileSize,
  workspacePathName,
} from './workspace-files-model'
import type { WorkspaceFilesViewProps } from './workspace-files-view-contract'

export type { WorkspaceFilesViewProps } from './workspace-files-view-contract'

const fullWidth = frame({ maxWidth: Infinity, minHeight: 44, alignment: 'leading' })
const plainButton = buttonStyle('plain')
const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })

export function WorkspaceFilesView({
  currentPath,
  entries,
  file,
  onBack,
  onOpenDirectory,
  onOpenFile,
  onRefresh,
  search,
}: WorkspaceFilesViewProps) {
  if (file) {
    const previewUnavailable = workspaceFilePreviewUnavailableDescription(
      file.info.size,
      file.previewable,
    )

    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <List modifiers={[listStyle('insetGrouped')]}>
          <Section>
            <Button modifiers={[plainButton]} onPress={onBack}>
              <HStack modifiers={[fullWidth]} spacing={10}>
                <Image color="blue" size={17} systemName="chevron.backward" />
                <Text modifiers={[foregroundStyle('blue')]}>Close Preview</Text>
                <Spacer />
              </HStack>
            </Button>
          </Section>
          <Section
            footer={(
              <Text modifiers={[secondaryForeground]}>
                {`${file.info.path} · ${workspaceFileSize(file.info.size)}`}
              </Text>
            )}
            title={file.info.name}
          >
            {file.previewable && file.content !== null
              ? (
                  <Text
                    modifiers={[
                      font({ design: 'monospaced', textStyle: 'caption' }),
                      textSelection(true),
                    ]}
                  >
                    {file.content}
                  </Text>
                )
              : (
                  <ContentUnavailableView
                    description={previewUnavailable}
                    systemImage="doc.questionmark"
                    title="Preview Unavailable"
                  />
                )}
          </Section>
        </List>
      </Host>
    )
  }

  const backLabel = search ? 'Clear Search' : currentPath ? 'Parent Directory' : 'Back to Workspace'
  const listModifiers = [
    listStyle('insetGrouped'),
    ...(onRefresh ? [refreshable(async () => { await onRefresh() })] : []),
  ]

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <List modifiers={listModifiers}>
        <Section
          footer={currentPath
            ? <Text modifiers={[secondaryForeground]}>{currentPath}</Text>
            : undefined}
          title={search ? 'Search Results' : workspacePathName(currentPath)}
        >
          <Button modifiers={[plainButton]} onPress={onBack}>
            <HStack modifiers={[fullWidth]} spacing={10}>
              <Image color="blue" size={17} systemName="chevron.backward" />
              <Text modifiers={[foregroundStyle('blue')]}>{backLabel}</Text>
              <Spacer />
            </HStack>
          </Button>

          {entries.map(entry => (
            <Button
              key={entry.path}
              modifiers={[plainButton]}
              onPress={() => entry.type === 'directory'
                ? onOpenDirectory(entry.path)
                : onOpenFile(entry.path)}
            >
              <HStack modifiers={[fullWidth]} spacing={12}>
                <Image
                  color={entry.type === 'directory' ? 'blue' : 'secondary'}
                  size={19}
                  systemName={entry.type === 'directory' ? 'folder.fill' : 'doc.text'}
                />
                <VStack alignment="leading" spacing={2}>
                  <Text>{entry.name}</Text>
                  {search && (
                    <Text
                      modifiers={[
                        font({ design: 'monospaced', textStyle: 'caption' }),
                        secondaryForeground,
                      ]}
                    >
                      {entry.path}
                    </Text>
                  )}
                </VStack>
                <Spacer />
                <Image color="secondary" size={14} systemName="chevron.forward" />
              </HStack>
            </Button>
          ))}

          {entries.length === 0 && (
            <ContentUnavailableView
              description={search
                ? 'Try a different file or directory name.'
                : 'This directory has no files.'}
              systemImage={search ? 'doc.text.magnifyingglass' : 'folder'}
              title={search ? 'No Matching Files' : 'Empty Directory'}
            />
          )}
        </Section>
      </List>
    </Host>
  )
}
