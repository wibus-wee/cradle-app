import { ArrowLeft, Check, GitCommit, MessageSquare, Send, X } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import Markdown from 'react-native-markdown-display'

import type { GetPullRequestsByOwnerByRepoByNumberDetailResponse } from '@/api-gen'
import { Button } from '@/components/ui/button'
import { PressableScale } from '@/components/ui/pressable-scale'
import { Screen } from '@/components/ui/screen'
import { StatusPill } from '@/components/ui/status-pill'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type Detail = GetPullRequestsByOwnerByRepoByNumberDetailResponse

export interface PullRequestDetailViewProps {
  detail: Detail
  isMutating?: boolean
  onBack: () => void
  onComment: (body: string) => void
  onReview: (event: 'APPROVE' | 'REQUEST_CHANGES', body: string) => void
}

export function PullRequestDetailView({
  detail,
  isMutating = false,
  onBack,
  onComment,
  onReview,
}: PullRequestDetailViewProps) {
  const theme = useTheme()
  const [comment, setComment] = useState('')
  const { pullRequest } = detail

  const submitComment = () => {
    const body = comment.trim()
    if (!body) { return }
    onComment(body)
    setComment('')
  }

  return (
    <Screen
      action={<StatusPill label={pullRequest.isDraft ? 'draft' : pullRequest.state} tone={pullRequest.state === 'open' ? 'success' : 'neutral'} />}
      subtitle={`${pullRequest.owner}/${pullRequest.repo} #${pullRequest.number}`}
      title={pullRequest.title}
    >
      <PressableScale accessibilityLabel="Back" onPress={onBack} style={styles.back}>
        <ArrowLeft color={theme.mutedForeground} size={19} />
        <Text style={[styles.backText, { color: theme.mutedForeground }]}>Pull requests</Text>
      </PressableScale>

      <View style={styles.stats}>
        <View style={[styles.stat, { backgroundColor: `${theme.success}12` }]}>
          <Text style={[styles.statValue, { color: theme.success }]}>
+
{pullRequest.additions}
          </Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Additions</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: `${theme.destructive}12` }]}>
          <Text style={[styles.statValue, { color: theme.destructive }]}>
-
{pullRequest.deletions}
          </Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Deletions</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: theme.muted }]}>
          <Text style={[styles.statValue, { color: theme.foreground }]}>{pullRequest.changedFiles}</Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Files</Text>
        </View>
      </View>

      {pullRequest.body && (
        <View style={[styles.body, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Markdown style={{ body: { color: theme.foreground, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 21 } }}>
            {pullRequest.body}
          </Markdown>
        </View>
      )}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Checks</Text>
        {pullRequest.checks.length === 0
          ? <Text style={[styles.emptyText, { color: theme.mutedForeground }]}>No checks reported.</Text>
          : pullRequest.checks.map(check => (
              <View key={check.id} style={[styles.check, { borderBottomColor: theme.border }]}>
                {check.conclusion === 'success'
                  ? <Check color={theme.success} size={17} />
                  : check.conclusion === 'failure'
                    ? <X color={theme.destructive} size={17} />
                    : <GitCommit color={theme.warning} size={17} />}
                <Text style={[styles.checkName, { color: theme.foreground }]}>{check.name}</Text>
                <Text style={[styles.checkStatus, { color: theme.mutedForeground }]}>
                  {check.conclusion ?? check.status}
                </Text>
              </View>
            ))}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Changed files</Text>
        {detail.files.map(file => (
          <View key={file.sha + file.filename} style={[styles.file, { borderBottomColor: theme.border }]}>
            <Text numberOfLines={1} style={[styles.fileName, { color: theme.foreground }]}>{file.filename}</Text>
            <Text style={[styles.fileStats, { color: theme.success }]}>
+
{file.additions}
            </Text>
            <Text style={[styles.fileStats, { color: theme.destructive }]}>
-
{file.deletions}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Conversation</Text>
        {detail.timeline.slice(-20).map(item => (
          <View key={item.id} style={[styles.timeline, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.timelineHeader}>
              <MessageSquare color={theme.mutedForeground} size={16} />
              <Text style={[styles.author, { color: theme.foreground }]}>
                {item.author?.login ?? 'Unknown'}
              </Text>
              {item.state && <StatusPill label={item.state.toLowerCase()} />}
            </View>
            {item.body && <Text style={[styles.timelineBody, { color: theme.foreground }]}>{item.body}</Text>}
          </View>
        ))}
      </View>

      <View style={styles.comment}>
        <TextInput
          multiline
          onChangeText={setComment}
          placeholder="Add a comment or review note..."
          placeholderTextColor={theme.mutedForeground}
          style={[styles.commentInput, { backgroundColor: theme.card, borderColor: theme.input, color: theme.foreground }]}
          textAlignVertical="top"
          value={comment}
        />
        <Button
          disabled={!comment.trim()}
          icon={Send}
          label="Comment"
          loading={isMutating}
          onPress={submitComment}
          variant="secondary"
        />
        <View style={styles.reviewActions}>
          <Button
            disabled={!comment.trim()}
            icon={X}
            label="Request changes"
            loading={isMutating}
            onPress={() => onReview('REQUEST_CHANGES', comment.trim())}
            style={styles.reviewButton}
            variant="destructive"
          />
          <Button
            icon={Check}
            label="Approve"
            loading={isMutating}
            onPress={() => onReview('APPROVE', comment.trim())}
            style={styles.reviewButton}
          />
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  author: {
    flex: 1,
    fontFamily: 'Geist_600SemiBold',
    fontSize: 13,
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
  body: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  check: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
  },
  checkName: {
    flex: 1,
    fontFamily: 'Geist_500Medium',
    fontSize: 13,
  },
  checkStatus: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
  },
  comment: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  commentInput: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontFamily: 'Geist_400Regular',
    fontSize: 14,
    minHeight: 110,
    padding: spacing.md,
  },
  emptyText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
  },
  file: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
  },
  fileName: {
    flex: 1,
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
  },
  fileStats: {
    fontFamily: 'Geist_500Medium',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  reviewActions: {
    gap: spacing.sm,
  },
  reviewButton: {
    flex: 1,
  },
  section: {
    marginTop: spacing.xl,
  },
  sectionTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 17,
    marginBottom: spacing.md,
  },
  stat: {
    borderRadius: radius.md,
    flex: 1,
    gap: spacing.xs,
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
  },
  timeline: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  timelineBody: {
    fontFamily: 'Geist_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  timelineHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
})
