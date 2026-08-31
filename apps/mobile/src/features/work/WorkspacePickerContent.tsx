import { Check, FolderGit2, Search, X } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import { PressableScale } from '@/components/ui/pressable-scale'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import type { WorkspacePickerSheetProps } from './workspace-picker-sheet-contract'

interface WorkspacePickerContentProps extends WorkspacePickerSheetProps {
  bottomPadding?: number
  fill?: boolean
}

export function WorkspacePickerContent({
  bottomPadding = spacing.sm,
  fill = false,
  onClose,
  onSelect,
  selectedWorkspaceId,
  visible,
  workspaces,
}: WorkspacePickerContentProps) {
  const theme = useTheme()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (visible) {
      setQuery('')
    }
  }, [visible])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredWorkspaces = normalizedQuery
    ? workspaces.filter(workspace =>
        workspace.name.toLowerCase().includes(normalizedQuery)
        || workspace.locator.path.toLowerCase().includes(normalizedQuery))
    : workspaces
  const showsSearch = workspaces.length > 5

  return (
    <View style={[styles.content, fill && styles.contentFill]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.foreground }]}>Repository</Text>
        <PressableScale
          accessibilityLabel="Close repository picker"
          accessibilityRole="button"
          onPress={onClose}
          style={[styles.closeButton, { backgroundColor: theme.muted }]}
        >
          <X color={theme.tertiaryForeground} size={18} />
        </PressableScale>
      </View>

      {showsSearch && (
        <View
          style={[
            styles.search,
            {
              backgroundColor: theme.surfaceInset,
              borderColor: theme.input,
            },
          ]}
        >
          <Search color={theme.mutedForeground} size={16} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder="Search repositories"
            placeholderTextColor={theme.mutedForeground}
            returnKeyType="search"
            style={[styles.searchInput, { color: theme.foreground }]}
            value={query}
          />
        </View>
      )}

      <ScrollView
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomPadding }]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={fill ? styles.listFill : styles.list}
      >
        {filteredWorkspaces.map((workspace) => {
          const selected = workspace.id === selectedWorkspaceId
          const branch = workspace.gitIdentity.branch
          return (
            <PressableScale
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={workspace.id}
              onPress={() => {
                onSelect(workspace.id)
                onClose()
              }}
              style={[
                styles.row,
                selected && { backgroundColor: theme.muted },
              ]}
            >
              <View style={[styles.repositoryIcon, { backgroundColor: theme.surfaceInset }]}>
                <FolderGit2 color={theme.workspace} size={18} />
              </View>
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.foreground }]}>
                  {workspace.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.rowDescription, { color: theme.mutedForeground }]}
                >
                  {branch ? `${workspace.locator.path} / ${branch}` : workspace.locator.path}
                </Text>
              </View>
              <View style={styles.checkSlot}>
                {selected && <Check color={theme.workspace} size={18} strokeWidth={2.4} />}
              </View>
            </PressableScale>
          )
        })}
        {filteredWorkspaces.length === 0 && (
          <Text style={[styles.empty, { color: theme.mutedForeground }]}>
            No repositories found
          </Text>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  checkSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  content: {
    flexShrink: 1,
  },
  contentFill: {
    flex: 1,
  },
  empty: {
    fontSize: 13,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  list: {
    flexShrink: 1,
  },
  listContent: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  listFill: {
    flex: 1,
  },
  repositoryIcon: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  row: {
    alignItems: 'center',
    borderRadius: radius.xl,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 60,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  rowText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  search: {
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    height: 44,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.md,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: 44,
    paddingVertical: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
})
