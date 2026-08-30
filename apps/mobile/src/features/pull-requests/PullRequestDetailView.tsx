import { Check, ExternalLink, GitCommit, MessageSquare, Send, X } from 'lucide-react-native'
import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import Markdown from 'react-native-markdown-display'

import type { GetPullRequestsByOwnerByRepoByNumberDetailResponse } from '@/api-gen'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { InputGroup } from '@/components/ui/input-group'
import { Item } from '@/components/ui/item'
import { NativeAction } from '@/components/ui/native-action'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { StatusPill } from '@/components/ui/status-pill'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type Detail = GetPullRequestsByOwnerByRepoByNumberDetailResponse

export interface PullRequestDetailViewProps {
  detail: Detail
  isMutating?: boolean
  onComment: (body: string) => void
  onOpenExternal: () => Promise<void>
  onReview: (event: 'APPROVE' | 'REQUEST_CHANGES', body: string) => void
}

export function PullRequestDetailView({
  detail,
  isMutating = false,
  onComment,
  onOpenExternal,
  onReview,
}: PullRequestDetailViewProps) {
  const theme = useTheme()
  const [comment, setComment] = useState('')
  const { pullRequest } = detail

  const openExternal = async () => {
    try {
      await onOpenExternal()
    }
    catch {
      Alert.alert('Could not open pull request on GitHub')
    }
  }

  const submitComment = () => {
    const body = comment.trim()
    if (!body) { return }
    onComment(body)
    setComment('')
  }

  return (
    <Screen
      action={(
        <View style={styles.headerActions}>
          <StatusPill label={pullRequest.isDraft ? 'draft' : pullRequest.state} tone={pullRequest.state === 'open' ? 'success' : 'neutral'} />
          <IconButton
            accessibilityLabel="Open pull request on GitHub"
            icon={ExternalLink}
            onPress={() => void openExternal()}
          />
        </View>
      )}
      insetTop={false}
      subtitle={`${pullRequest.owner}/${pullRequest.repo} #${pullRequest.number}`}
      title={pullRequest.title}
    >
      <View style={[styles.stats, { borderColor: theme.border }]}>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: theme.success }]}>
+
{pullRequest.additions}
          </Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Additions</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: theme.destructive }]}>
-
{pullRequest.deletions}
          </Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Deletions</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: theme.foreground }]}>{pullRequest.changedFiles}</Text>
          <Text style={[styles.statLabel, { color: theme.mutedForeground }]}>Files</Text>
        </View>
      </View>

      {pullRequest.body && (
        <View style={[styles.body, { borderBottomColor: theme.border }]}>
          <Markdown style={{ body: { color: theme.foreground, fontSize: 14, lineHeight: 21 } }}>
            {pullRequest.body}
          </Markdown>
        </View>
      )}

      <View style={styles.section}>
        <SectionHeading meta={`${pullRequest.checks.length}`} title="Checks" />
        {pullRequest.checks.length === 0
          ? <Text style={[styles.emptyText, { color: theme.mutedForeground }]}>No checks reported.</Text>
          : pullRequest.checks.map(check => (
              <Item
                actions={(
                  <Text style={[styles.checkStatus, { color: theme.mutedForeground }]}>
                    {check.conclusion ?? check.status}
                  </Text>
                )}
                key={check.id}
                media={check.conclusion === 'success'
                  ? <Check color={theme.success} size={17} />
                  : check.conclusion === 'failure'
                    ? <X color={theme.destructive} size={17} />
                    : <GitCommit color={theme.warning} size={17} />}
                size="sm"
                title={check.name}
                variant="muted"
              />
            ))}
      </View>

      <View style={styles.section}>
        <SectionHeading meta={`${detail.files.length}`} title="Changed files" />
        {detail.files.map(file => (
          <Item
            actions={(
              <>
                <Text style={[styles.fileStats, { color: theme.success }]}>{`+${file.additions}`}</Text>
                <Text style={[styles.fileStats, { color: theme.destructive }]}>{`-${file.deletions}`}</Text>
              </>
            )}
            key={file.sha + file.filename}
            size="sm"
            title={file.filename}
          />
        ))}
      </View>

      <View style={styles.section}>
        <SectionHeading meta={`${detail.timeline.length} events`} title="Conversation" />
        {detail.timeline.slice(-20).map(item => (
          <View key={item.id} style={[styles.timeline, { borderBottomColor: theme.border }]}>
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
        <InputGroup
          multiline
          onChangeText={setComment}
          placeholder="Add a comment or review note..."
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
          <NativeAction
            disabled={!comment.trim()}
            label="Request changes"
            loading={isMutating}
            onPress={() => onReview('REQUEST_CHANGES', comment.trim())}
            style={styles.reviewButton}
            role="destructive"
            variant="outlined"
          />
          <NativeAction
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

    fontSize: 13,
  },
  body: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  checkStatus: {

    fontSize: 12,
  },
  comment: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  emptyText: {

    fontSize: 13,
  },
  fileStats: {

    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
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
  stat: {
    flex: 1,
    gap: spacing.xs,
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
  },
  timeline: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  timelineBody: {

    fontSize: 13,
    lineHeight: 19,
  },
  timelineHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
})
