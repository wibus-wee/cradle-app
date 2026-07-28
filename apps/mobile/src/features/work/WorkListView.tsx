import { Check, GitBranch, Plus, X } from 'lucide-react-native'
import { useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'

import type { GetWorkspacesResponse, GetWorksResponse } from '@/api-gen'
import { Button } from '@/components/ui/button'
import { PressableScale } from '@/components/ui/pressable-scale'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status-pill'
import { relativeTime } from '@/lib/format'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type Work = GetWorksResponse[number]
type Workspace = GetWorkspacesResponse[number]

export interface CreateWorkInput {
  workspaceId: string
  title: string
  objective: string
}

export interface WorkListViewProps {
  works: Work[]
  workspaces: Workspace[]
  isCreating?: boolean
  isRefreshing?: boolean
  onCreate: (input: CreateWorkInput) => void
  onOpen: (workId: string) => void
  onRefresh?: () => void
}

function activityTone(activity: Work['activity']) {
  if (activity === 'running') { return 'success' as const }
  if (activity === 'waiting') { return 'warning' as const }
  if (activity === 'blocked') { return 'danger' as const }
  return 'neutral' as const
}

export function WorkListView({
  works,
  workspaces,
  isCreating = false,
  isRefreshing = false,
  onCreate,
  onOpen,
  onRefresh,
}: WorkListViewProps) {
  const theme = useTheme()
  const [showCreate, setShowCreate] = useState(false)
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')

  const submit = () => {
    if (!workspaceId || !title.trim()) { return }
    onCreate({ workspaceId, title: title.trim(), objective: objective.trim() })
    setShowCreate(false)
    setTitle('')
    setObjective('')
  }

  return (
    <Screen
      action={(
        <PressableScale
          accessibilityLabel="New Work"
          onPress={() => setShowCreate(true)}
          style={[styles.addButton, { backgroundColor: theme.primary }]}
        >
          <Plus color={theme.primaryForeground} size={20} />
        </PressableScale>
      )}
      onRefresh={onRefresh}
      refreshing={isRefreshing}
      subtitle="Isolated tasks you can continue from anywhere"
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
            <View style={styles.list}>
              {works.map(work => (
                <PressableScale
                  key={work.id}
                  onPress={() => onOpen(work.id)}
                  style={[styles.row, { backgroundColor: theme.card, borderColor: theme.border }]}
                >
                  <View style={[styles.iconFrame, { backgroundColor: theme.muted }]}>
                    <GitBranch color={theme.foreground} size={20} />
                  </View>
                  <View style={styles.copy}>
                    <Text numberOfLines={1} style={[styles.title, { color: theme.foreground }]}>{work.title}</Text>
                    <Text numberOfLines={2} style={[styles.objective, { color: theme.mutedForeground }]}>
                      {work.objective}
                    </Text>
                    <View style={styles.meta}>
                      <StatusPill label={work.activity} tone={activityTone(work.activity)} />
                      <Text style={[styles.time, { color: theme.mutedForeground }]}>{relativeTime(work.updatedAt)}</Text>
                    </View>
                  </View>
                </PressableScale>
              ))}
            </View>
          )}

      <Modal
        animationType="slide"
        onRequestClose={() => setShowCreate(false)}
        presentationStyle="pageSheet"
        visible={showCreate}
      >
        <ScrollView
          contentContainerStyle={[styles.modal, { backgroundColor: theme.background }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.foreground }]}>New Work</Text>
            <PressableScale accessibilityLabel="Close" onPress={() => setShowCreate(false)} style={styles.closeButton}>
              <X color={theme.foreground} size={21} />
            </PressableScale>
          </View>

          <Text style={[styles.label, { color: theme.mutedForeground }]}>PROJECT</Text>
          <View style={styles.workspaceList}>
            {workspaces.map(workspace => (
              <PressableScale
                key={workspace.id}
                onPress={() => setWorkspaceId(workspace.id)}
                style={[
                  styles.workspaceOption,
                  { backgroundColor: workspace.id === workspaceId ? theme.muted : theme.card, borderColor: theme.border },
                ]}
              >
                <Text style={[styles.workspaceName, { color: theme.foreground }]}>{workspace.name}</Text>
                {workspace.id === workspaceId && <Check color={theme.success} size={18} />}
              </PressableScale>
            ))}
          </View>

          <Text style={[styles.label, { color: theme.mutedForeground }]}>TITLE</Text>
          <TextInput
            onChangeText={setTitle}
            placeholder="What are we building?"
            placeholderTextColor={theme.mutedForeground}
            style={[styles.textInput, { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground }]}
            value={title}
          />

          <Text style={[styles.label, { color: theme.mutedForeground }]}>OBJECTIVE</Text>
          <TextInput
            multiline
            onChangeText={setObjective}
            placeholder="Describe the outcome and constraints..."
            placeholderTextColor={theme.mutedForeground}
            style={[styles.textInput, styles.objectiveInput, { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground }]}
            textAlignVertical="top"
            value={objective}
          />

          <Button
            disabled={!workspaceId || !title.trim()}
            label="Create isolated Work"
            loading={isCreating}
            onPress={submit}
            style={styles.createButton}
          />
        </ScrollView>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  closeButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  copy: {
    flex: 1,
    gap: spacing.sm,
  },
  createButton: {
    marginTop: spacing.xl,
  },
  iconFrame: {
    alignItems: 'center',
    borderRadius: radius.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  label: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 11,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  list: {
    gap: spacing.md,
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modal: {
    flexGrow: 1,
    padding: spacing.xl,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 24,
  },
  objective: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  objectiveInput: {
    height: 120,
    paddingTop: spacing.md,
  },
  row: {
    alignItems: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 132,
    padding: spacing.lg,
  },
  textInput: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: 'Geist_400Regular',
    fontSize: 15,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  time: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  title: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 16,
  },
  workspaceList: {
    gap: spacing.sm,
  },
  workspaceName: {
    fontFamily: 'Geist_500Medium',
    fontSize: 14,
  },
  workspaceOption: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
})
