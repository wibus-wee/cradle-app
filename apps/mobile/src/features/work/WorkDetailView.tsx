import { ArrowLeft, GitPullRequest, MessageSquareText, UploadCloud } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'

import type { GetWorksByIdResponse } from '@/api-gen'
import { Button } from '@/components/ui/button'
import { PressableScale } from '@/components/ui/pressable-scale'
import { Screen } from '@/components/ui/screen'
import { StatusPill } from '@/components/ui/status-pill'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export interface WorkHandoff {
  title: string
  summary: string
  testPlan: string
}

export interface WorkDetailViewProps {
  detail: GetWorksByIdResponse
  isPreparing?: boolean
  isSubmitting?: boolean
  onBack: () => void
  onOpenChat: (sessionId: string) => void
  onOpenPullRequest: (owner: string, repo: string, number: number) => void
  onPrepare: (handoff: WorkHandoff) => void
  onSubmit: (handoff: WorkHandoff) => void
}

export function WorkDetailView({
  detail,
  isPreparing = false,
  isSubmitting = false,
  onBack,
  onOpenChat,
  onOpenPullRequest,
  onPrepare,
  onSubmit,
}: WorkDetailViewProps) {
  const theme = useTheme()
  const [handoff, setHandoff] = useState<WorkHandoff>({
    title: detail.work.handoffTitle ?? detail.work.title,
    summary: detail.work.handoffSummary ?? '',
    testPlan: detail.work.handoffTestPlan ?? '',
  })
  const canHandoff = handoff.title.trim() && handoff.summary.trim() && handoff.testPlan.trim()

  return (
    <Screen
      action={<StatusPill label={detail.activity} tone={detail.activity === 'running' ? 'success' : 'neutral'} />}
      subtitle={detail.execution.worktreeBranch ?? 'Preparing isolated checkout'}
      title={detail.work.title}
    >
      <PressableScale accessibilityLabel="Back" onPress={onBack} style={styles.back}>
        <ArrowLeft color={theme.mutedForeground} size={19} />
        <Text style={[styles.backText, { color: theme.mutedForeground }]}>Work</Text>
      </PressableScale>

      <View style={[styles.objective, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.label, { color: theme.mutedForeground }]}>OBJECTIVE</Text>
        <Text style={[styles.objectiveText, { color: theme.foreground }]}>{detail.work.objective}</Text>
      </View>

      <Button
        icon={MessageSquareText}
        label={detail.primaryThread.status === 'streaming' ? 'Follow active conversation' : 'Continue conversation'}
        onPress={() => onOpenChat(detail.primaryThread.id)}
      />

      <View style={styles.stats}>
        <View style={[styles.stat, { backgroundColor: theme.muted }]}>
          <Text style={[styles.statValue, { color: theme.foreground }]}>{detail.readiness.changedFiles}</Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Changed files</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: theme.muted }]}>
          <Text style={[styles.statValue, { color: theme.foreground }]}>{detail.readiness.commitsAhead}</Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Commits ahead</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: theme.muted }]}>
          <Text style={[styles.statValue, { color: detail.readiness.clean ? theme.success : theme.warning }]}>
            {detail.readiness.clean ? 'Clean' : 'Dirty'}
          </Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Worktree</Text>
        </View>
      </View>

      <View style={styles.handoff}>
        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Pull request handoff</Text>
        <TextInput
          onChangeText={title => setHandoff(current => ({ ...current, title }))}
          placeholder="Pull request title"
          placeholderTextColor={theme.mutedForeground}
          style={[styles.input, { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground }]}
          value={handoff.title}
        />
        <TextInput
          multiline
          onChangeText={summary => setHandoff(current => ({ ...current, summary }))}
          placeholder="What changed and why"
          placeholderTextColor={theme.mutedForeground}
          style={[styles.input, styles.multiline, { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground }]}
          textAlignVertical="top"
          value={handoff.summary}
        />
        <TextInput
          multiline
          onChangeText={testPlan => setHandoff(current => ({ ...current, testPlan }))}
          placeholder="Verification performed"
          placeholderTextColor={theme.mutedForeground}
          style={[styles.input, styles.multiline, { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground }]}
          textAlignVertical="top"
          value={handoff.testPlan}
        />
        <View style={styles.actions}>
          <Button
            disabled={!canHandoff}
            label="Save handoff"
            loading={isPreparing}
            onPress={() => onPrepare(handoff)}
            style={styles.action}
            variant="secondary"
          />
          <Button
            disabled={!canHandoff || !detail.readiness.clean || detail.readiness.commitsAhead === 0}
            icon={UploadCloud}
            label={detail.pullRequest ? 'Update PR' : 'Create draft PR'}
            loading={isSubmitting}
            onPress={() => onSubmit(handoff)}
            style={styles.action}
          />
        </View>
      </View>

      {detail.pullRequest && (
        <PressableScale
          onPress={() => onOpenPullRequest(
            detail.pullRequest!.owner,
            detail.pullRequest!.repo,
            detail.pullRequest!.number,
          )}
          style={[styles.pr, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <GitPullRequest color={theme.success} size={20} />
          <View style={styles.prCopy}>
            <Text style={[styles.prTitle, { color: theme.foreground }]}>
              #
{detail.pullRequest.number}
{' '}
{detail.pullRequest.title}
            </Text>
            <Text style={[styles.prMeta, { color: theme.mutedForeground }]}>
              {detail.pullRequest.isDraft ? 'Draft' : 'Ready'}
{' '}
·
{detail.pullRequest.state}
            </Text>
          </View>
        </PressableScale>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  action: {
    flex: 1,
  },
  actions: {
    gap: spacing.sm,
  },
  back: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    height: 40,
    marginBottom: spacing.sm,
    marginTop: -spacing.lg,
  },
  backText: {
    fontFamily: 'Geist_500Medium',
    fontSize: 14,
  },
  handoff: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
    minHeight: 48,
    padding: spacing.md,
  },
  label: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 11,
  },
  multiline: {
    minHeight: 96,
  },
  objective: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  objectiveText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 15,
    lineHeight: 22,
  },
  pr: {
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
    minHeight: 72,
    padding: spacing.lg,
  },
  prCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  prMeta: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
  },
  prTitle: {
    fontFamily: 'Geist_500Medium',
    fontSize: 14,
  },
  sectionTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 18,
  },
  stat: {
    borderRadius: radius.md,
    flex: 1,
    gap: spacing.xs,
    minHeight: 76,
    padding: spacing.md,
  },
  statLabel: {
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
  },
  statValue: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 17,
    fontVariant: ['tabular-nums'],
  },
  stats: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
})
