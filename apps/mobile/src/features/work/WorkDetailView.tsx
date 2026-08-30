import { GitPullRequest } from 'lucide-react-native'
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
  onOpenPullRequest: (owner: string, repo: string, number: number) => void
  onPrepare: (handoff: WorkHandoff) => Promise<void>
  onSubmit: (handoff: WorkHandoff) => Promise<void>
}

export function WorkDetailView({
  detail,
  isPreparing = false,
  isSubmitting = false,
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
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error', text: string } | null>(null)
  const canHandoff = handoff.title.trim() && handoff.summary.trim() && handoff.testPlan.trim()

  const saveHandoff = async () => {
    setFeedback(null)
    try {
      await onPrepare(handoff)
      setFeedback({ text: 'Handoff saved', tone: 'success' })
    }
    catch {
      setFeedback({ text: 'Could not save handoff. Your text has been preserved.', tone: 'error' })
    }
  }

  const submitHandoff = async () => {
    setFeedback(null)
    try {
      await onSubmit(handoff)
      setFeedback({
        text: detail.pullRequest ? 'Pull request updated' : 'Draft pull request created',
        tone: 'success',
      })
    }
    catch {
      setFeedback({ text: 'Could not submit handoff. Your text has been preserved.', tone: 'error' })
    }
  }

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
          editable={!isPreparing && !isSubmitting}
          onChangeText={(title) => {
            setFeedback(null)
            setHandoff(current => ({ ...current, title }))
          }}
          placeholder="Pull request title"
          value={handoff.title}
        />
        <InputGroup
          editable={!isPreparing && !isSubmitting}
          multiline
          onChangeText={(summary) => {
            setFeedback(null)
            setHandoff(current => ({ ...current, summary }))
          }}
          placeholder="What changed and why"
          value={handoff.summary}
        />
        <InputGroup
          editable={!isPreparing && !isSubmitting}
          multiline
          onChangeText={(testPlan) => {
            setFeedback(null)
            setHandoff(current => ({ ...current, testPlan }))
          }}
          placeholder="Verification performed"
          value={handoff.testPlan}
        />
        {feedback && (
          <Text style={[
            styles.feedback,
            { color: feedback.tone === 'success' ? theme.success : theme.destructive },
          ]}
          >
            {feedback.text}
          </Text>
        )}
        <View style={styles.actions}>
          <Button
            disabled={!canHandoff || isPreparing || isSubmitting}
            label="Save handoff"
            loading={isPreparing}
            onPress={() => void saveHandoff()}
            style={styles.action}
            variant="secondary"
          />
          <NativeAction
            disabled={!canHandoff || isPreparing || isSubmitting || !detail.readiness.clean || detail.readiness.commitsAhead === 0}
            label={detail.pullRequest ? 'Update PR' : 'Create draft PR'}
            loading={isSubmitting}
            onPress={() => void submitHandoff()}
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
  feedback: {
    fontSize: 12,
    lineHeight: 17,
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
