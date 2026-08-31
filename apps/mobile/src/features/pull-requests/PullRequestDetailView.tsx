import { Check, ChevronDown, ChevronUp, ExternalLink, GitCommit, MessageSquare, X } from 'lucide-react-native'
import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import Markdown from 'react-native-markdown-display'

import type { GetPullRequestsByOwnerByRepoByNumberDetailResponse } from '@/api-gen'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { StatusPill } from '@/components/ui/status-pill'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import type { PullRequestReviewComposerProps } from './pull-request-review-composer-contract'
import { PullRequestReviewComposer } from './PullRequestReviewComposer'

type Detail = GetPullRequestsByOwnerByRepoByNumberDetailResponse

export interface PullRequestDetailViewProps extends PullRequestReviewComposerProps {
  detail: Detail
  nativeHeader?: boolean
  onOpenExternal: (url: string) => Promise<void>
}

export function PullRequestDetailView({
  detail,
  isMutating = false,
  nativeHeader = false,
  onComment,
  onOpenExternal,
  onReview,
}: PullRequestDetailViewProps) {
  const theme = useTheme()
  const [showAllTimeline, setShowAllTimeline] = useState(false)
  const { pullRequest } = detail
  const visibleTimeline = showAllTimeline ? detail.timeline : detail.timeline.slice(-20)
  const status = (
    <StatusPill
      label={pullRequest.isDraft ? 'draft' : pullRequest.state}
      tone={pullRequest.state === 'open' ? 'success' : 'neutral'}
    />
  )

  const openExternal = async (url: string, failureMessage: string) => {
    try {
      await onOpenExternal(url)
    }
    catch {
      Alert.alert(failureMessage)
    }
  }

  return (
    <Screen
      action={nativeHeader
        ? status
        : (
            <View style={styles.headerActions}>
              {status}
              <IconButton
                accessibilityLabel="Open pull request on GitHub"
                icon={ExternalLink}
                onPress={() => void openExternal(
                  pullRequest.url,
                  'Could not open pull request on GitHub',
                )}
              />
            </View>
          )}
      insetTop={false}
      nativeHeader={nativeHeader}
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

      {pullRequest.labels.length > 0 && (
        <View style={styles.section}>
          <SectionHeading meta={`${pullRequest.labels.length}`} title="Labels" />
          <View style={styles.labels}>
            {pullRequest.labels.map(label => (
              <View
                key={label.name}
                style={[styles.label, { borderColor: theme.input }]}
              >
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[styles.labelDot, { backgroundColor: `#${label.color}` }]}
                />
                <Text style={[styles.labelText, { color: theme.foreground }]}>
                  {label.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.section}>
        <SectionHeading meta={`${pullRequest.checks.length}`} title="Checks" />
        {pullRequest.checks.length === 0
          ? <Text style={[styles.emptyText, { color: theme.mutedForeground }]}>No checks reported.</Text>
          : pullRequest.checks.map(check => (
              <Item
                actions={(
                  <View style={styles.checkActions}>
                    <Text style={[styles.checkStatus, { color: theme.mutedForeground }]}>
                      {check.conclusion ?? check.status}
                    </Text>
                    {check.url && <ExternalLink color={theme.dimForeground} size={15} />}
                  </View>
                )}
                key={check.id}
                media={check.conclusion === 'success'
                  ? <Check color={theme.success} size={17} />
                  : check.conclusion === 'failure'
                    ? <X color={theme.destructive} size={17} />
                    : <GitCommit color={theme.warning} size={17} />}
                size="sm"
                title={check.name}
                onPress={check.url
                  ? () => void openExternal(check.url!, 'Could not open check details')
                  : undefined}
                variant="muted"
              />
            ))}
      </View>

      <View style={styles.section}>
        <SectionHeading meta={`${detail.files.length}`} title="Changed files" />
        {detail.files.map(file => (
          <Item
            actions={(
              <View style={styles.fileActions}>
                <Text style={[styles.fileStats, { color: theme.success }]}>{`+${file.additions}`}</Text>
                <Text style={[styles.fileStats, { color: theme.destructive }]}>{`-${file.deletions}`}</Text>
                <ExternalLink color={theme.dimForeground} size={15} />
              </View>
            )}
            key={file.sha + file.filename}
            onPress={() => void openExternal(file.blobUrl, 'Could not open changed file')}
            size="sm"
            title={file.filename}
          />
        ))}
      </View>

      <View style={styles.section}>
        <SectionHeading meta={`${detail.timeline.length} events`} title="Conversation" />
        {detail.timeline.length > 20 && (
          <Button
            icon={showAllTimeline ? ChevronDown : ChevronUp}
            label={showAllTimeline
              ? 'Show latest 20'
              : `Show ${detail.timeline.length - 20} earlier events`}
            onPress={() => setShowAllTimeline(current => !current)}
            style={styles.timelineToggle}
            variant="secondary"
          />
        )}
        {visibleTimeline.map(item => (
          <Pressable
            accessibilityRole={item.url ? 'link' : undefined}
            disabled={!item.url}
            key={item.id}
            onPress={item.url
              ? () => void openExternal(item.url!, 'Could not open conversation event')
              : undefined}
            style={({ pressed }) => [
              styles.timeline,
              { borderBottomColor: theme.border },
              pressed && styles.timelinePressed,
            ]}
          >
            <View style={styles.timelineHeader}>
              <MessageSquare color={theme.mutedForeground} size={16} />
              <Text style={[styles.author, { color: theme.foreground }]}>
                {item.author?.login ?? 'Unknown'}
              </Text>
              {item.state && <StatusPill label={item.state.toLowerCase()} />}
              {item.url && <ExternalLink color={theme.dimForeground} size={15} />}
            </View>
            {item.body && <Text style={[styles.timelineBody, { color: theme.foreground }]}>{item.body}</Text>}
          </Pressable>
        ))}
      </View>

      <PullRequestReviewComposer
        isMutating={isMutating}
        onComment={onComment}
        onReview={onReview}
      />
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
  checkActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  emptyText: {

    fontSize: 13,
  },
  fileStats: {

    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  fileActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  label: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  labelDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  labels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  labelText: {
    fontSize: 12,
    lineHeight: 16,
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
  timelinePressed: {
    opacity: 0.65,
  },
  timelineToggle: {
    marginTop: spacing.sm,
  },
})
