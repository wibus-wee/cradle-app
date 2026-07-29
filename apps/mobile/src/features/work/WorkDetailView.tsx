import { GitPullRequest, MessageSquareText } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type { GetWorksByIdResponse } from '@/api-gen'
import { Button } from '@/components/ui/button'
import { InputGroup } from '@/components/ui/input-group'
import { Item } from '@/components/ui/item'
import { NativeAction } from '@/components/ui/native-action'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { StatusPill } from '@/components/ui/status-pill'
import { spacing } from '@/theme/tokens'
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
  onOpenChat: (sessionId: string) => void
  onOpenPullRequest: (owner: string, repo: string, number: number) => void
  onPrepare: (handoff: WorkHandoff) => void
  onSubmit: (handoff: WorkHandoff) => void
}

export function WorkDetailView({
  detail,
  isPreparing = false,
  isSubmitting = false,
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
      insetTop={false}
      subtitle={detail.execution.worktreeBranch ?? 'Preparing isolated checkout'}
      title={detail.work.title}
    >
      <View style={styles.objective}>
        <SectionHeading title="Objective" />
        <Text style={[styles.objectiveText, { color: theme.foreground }]}>{detail.work.objective}</Text>
      </View>

      <Button
        icon={MessageSquareText}
        label={detail.primaryThread.status === 'streaming' ? 'Follow active conversation' : 'Continue conversation'}
        onPress={() => onOpenChat(detail.primaryThread.id)}
      />

      <View style={[styles.stats, { borderColor: theme.border }]}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: theme.foreground }]}>{detail.readiness.changedFiles}</Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Changed files</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: theme.foreground }]}>{detail.readiness.commitsAhead}</Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Commits ahead</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: detail.readiness.clean ? theme.success : theme.warning }]}>
            {detail.readiness.clean ? 'Clean' : 'Dirty'}
          </Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Worktree</Text>
        </View>
      </View>

      <View style={styles.handoff}>
        <SectionHeading meta="Draft metadata" title="Pull request handoff" />
        <InputGroup
          onChangeText={title => setHandoff(current => ({ ...current, title }))}
          placeholder="Pull request title"
          value={handoff.title}
        />
        <InputGroup
          multiline
          onChangeText={summary => setHandoff(current => ({ ...current, summary }))}
          placeholder="What changed and why"
          value={handoff.summary}
        />
        <InputGroup
          multiline
          onChangeText={testPlan => setHandoff(current => ({ ...current, testPlan }))}
          placeholder="Verification performed"
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
          <NativeAction
            disabled={!canHandoff || !detail.readiness.clean || detail.readiness.commitsAhead === 0}
            label={detail.pullRequest ? 'Update PR' : 'Create draft PR'}
            loading={isSubmitting}
            onPress={() => onSubmit(handoff)}
            style={styles.action}
          />
        </View>
      </View>

      {detail.pullRequest && (
        <Item
          description={`${detail.pullRequest.isDraft ? 'Draft' : 'Ready'} · ${detail.pullRequest.state}`}
          media={<GitPullRequest color={theme.success} size={16} />}
          onPress={() => onOpenPullRequest(
            detail.pullRequest!.owner,
            detail.pullRequest!.repo,
            detail.pullRequest!.number,
          )}
          title={`#${detail.pullRequest.number} ${detail.pullRequest.title}`}
          variant="outline"
        />
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
  handoff: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  objective: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  objectiveText: {

    fontSize: 15,
    lineHeight: 22,
  },
  stat: {
    flex: 1,
    gap: spacing.xs,
    minHeight: 76,
    padding: spacing.md,
  },
  statLabel: {

    fontSize: 11,
  },
  statValue: {

    fontSize: 17,
    fontVariant: ['tabular-nums'],
  },
  stats: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginTop: spacing.md,
  },
})
