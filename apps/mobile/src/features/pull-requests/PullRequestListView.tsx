import { CheckCircle2, CircleDot, GitPullRequest, XCircle } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type {
  GetPullRequestsAuthoredResponse,
  GetPullRequestsReviewingResponse,
} from '@/api-gen'
import { PressableScale } from '@/components/ui/pressable-scale'
import { Screen } from '@/components/ui/screen'
import { EmptyState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status-pill'
import { relativeTime } from '@/lib/format'
import { radius, spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type PullRequest = GetPullRequestsAuthoredResponse['items'][number]

export interface PullRequestListViewProps {
  authored: GetPullRequestsAuthoredResponse['items']
  reviewing: GetPullRequestsReviewingResponse['items']
  login: string
  isRefreshing?: boolean
  onOpen: (pullRequest: PullRequest) => void
  onRefresh?: () => void
}

function ChecksIcon({ state }: { state: PullRequest['checksState'] }) {
  const theme = useTheme()
  if (state === 'success') { return <CheckCircle2 color={theme.success} size={17} /> }
  if (state === 'failure') { return <XCircle color={theme.destructive} size={17} /> }
  return <CircleDot color={state === 'pending' ? theme.warning : theme.mutedForeground} size={17} />
}

export function PullRequestListView({
  authored,
  reviewing,
  login,
  isRefreshing = false,
  onOpen,
  onRefresh,
}: PullRequestListViewProps) {
  const theme = useTheme()
  const [mode, setMode] = useState<'authored' | 'reviewing'>('authored')
  const items = mode === 'authored' ? authored : reviewing

  return (
    <Screen
      onRefresh={onRefresh}
      refreshing={isRefreshing}
      subtitle={`GitHub activity for @${login}`}
      title="Pull requests"
    >
      <View style={[styles.segmented, { backgroundColor: theme.muted }]}>
        {(['authored', 'reviewing'] as const).map(option => (
          <PressableScale
            key={option}
            onPress={() => setMode(option)}
            style={[
              styles.segment,
              option === mode && { backgroundColor: theme.card, shadowColor: theme.shadow, shadowOpacity: 0.08, shadowRadius: 2 },
            ]}
          >
            <Text style={[styles.segmentLabel, { color: option === mode ? theme.foreground : theme.mutedForeground }]}>
              {option === 'authored' ? 'Authored' : 'Review requests'}
            </Text>
          </PressableScale>
        ))}
      </View>

      {items.length === 0
        ? (
            <EmptyState
              description={mode === 'authored' ? 'Your open pull requests will appear here.' : 'You have no pending review requests.'}
              title="Inbox clear"
            />
          )
        : (
            <View style={styles.list}>
              {items.map(pullRequest => (
                <PressableScale
                  key={`${pullRequest.owner}/${pullRequest.repo}/${pullRequest.number}`}
                  onPress={() => onOpen(pullRequest)}
                  style={[styles.row, { backgroundColor: theme.card, borderColor: theme.border }]}
                >
                  <GitPullRequest color={pullRequest.state === 'open' ? theme.success : theme.mutedForeground} size={20} />
                  <View style={styles.copy}>
                    <Text style={[styles.repo, { color: theme.mutedForeground }]}>
                      {pullRequest.owner}
/
{pullRequest.repo}
{' '}
#
{pullRequest.number}
                    </Text>
                    <Text numberOfLines={2} style={[styles.title, { color: theme.foreground }]}>
                      {pullRequest.title}
                    </Text>
                    <View style={styles.meta}>
                      <ChecksIcon state={pullRequest.checksState} />
                      <StatusPill
                        label={pullRequest.isDraft ? 'draft' : pullRequest.state}
                        tone={pullRequest.isDraft ? 'neutral' : pullRequest.state === 'open' ? 'success' : 'neutral'}
                      />
                      <Text style={[styles.time, { color: theme.mutedForeground }]}>
                        {relativeTime(pullRequest.updatedAt)}
                      </Text>
                    </View>
                  </View>
                </PressableScale>
              ))}
            </View>
          )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    gap: 7,
  },
  list: {
    gap: spacing.md,
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  repo: {
    fontFamily: 'Geist_500Medium',
    fontSize: 12,
  },
  row: {
    alignItems: 'flex-start',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 124,
    padding: spacing.lg,
  },
  segment: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    height: 38,
    justifyContent: 'center',
  },
  segmentLabel: {
    fontFamily: 'Geist_500Medium',
    fontSize: 13,
  },
  segmented: {
    borderRadius: radius.md,
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xl,
    padding: spacing.xs,
  },
  time: {
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    marginLeft: 'auto',
  },
  title: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 15,
    lineHeight: 20,
  },
})
