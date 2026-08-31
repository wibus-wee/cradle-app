import { SegmentedControl } from '@expo/ui/community/segmented-control'
import { CheckCircle2, CircleDot, Search, XCircle } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { CradleIconButton } from '@/components/common/cradle-icon-button'
import { InputGroup } from '@/components/ui/input-group'
import { Item } from '@/components/ui/item'
import { Screen } from '@/components/ui/screen'
import { SectionHeading } from '@/components/ui/section-heading'
import { EmptyState } from '@/components/ui/states'
import { StatusPill } from '@/components/ui/status-pill'
import { relativeTime } from '@/lib/format'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import {
  pullRequestGroup,
  pullRequestGroupTitles,
  pullRequestMatchesSearch,
} from './pull-request-list-model'
import type {
  PullRequestListItem,
  PullRequestListViewProps,
} from './pull-request-list-view-contract'

export type { PullRequestListViewProps } from './pull-request-list-view-contract'

function ChecksIcon({ state }: { state: PullRequestListItem['checksState'] }) {
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
  onOpenUsage,
  onRefresh,
  onSearchQueryChange,
  searchQuery,
  showsInlineSearch = true,
}: PullRequestListViewProps) {
  const theme = useTheme()
  const [mode, setMode] = useState<'authored' | 'reviewing'>('authored')
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const sourceItems = mode === 'authored' ? authored : reviewing
  const items = normalizedSearch
    ? sourceItems.filter(pullRequest => pullRequestMatchesSearch(pullRequest, normalizedSearch))
    : sourceItems
  const groups = pullRequestGroupTitles
    .map(title => ({ title, items: items.filter(item => pullRequestGroup(item.updatedAt) === title) }))
    .filter(group => group.items.length > 0)

  return (
    <Screen
      leading={<CradleIconButton onPress={onOpenUsage} />}
      nativeHeader
      onRefresh={onRefresh}
      refreshing={isRefreshing}
      subtitle={`@${login}`}
      title="Pull requests"
    >
      <SegmentedControl
        appearance={theme.isDark ? 'dark' : 'light'}
        onValueChange={value => setMode(value === 'Review requests' ? 'reviewing' : 'authored')}
        selectedIndex={mode === 'authored' ? 0 : 1}
        style={styles.segmented}
        values={['Authored', 'Review requests']}
      />

      {showsInlineSearch && (
        <View style={styles.search}>
          <InputGroup
            addon={<Search color={theme.mutedForeground} size={17} />}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={onSearchQueryChange}
            placeholder="Search pull requests"
            returnKeyType="search"
            value={searchQuery}
          />
        </View>
      )}

      {items.length === 0
        ? (
            <EmptyState
              description={normalizedSearch
                ? 'Try a different title, repository, owner, or number.'
                : mode === 'authored'
                  ? 'Your open pull requests will appear here.'
                  : 'You have no pending review requests.'}
              title={normalizedSearch ? 'No matching pull requests' : 'Inbox clear'}
            />
          )
        : (
            <View>
              {groups.map(group => (
                <View key={group.title} style={styles.group}>
                  <SectionHeading title={group.title} />
                  {group.items.map(pullRequest => (
                    <Item
                      description={`${pullRequest.owner}/${pullRequest.repo} #${pullRequest.number}`}
                      footer={(
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
                      )}
                      key={`${pullRequest.owner}/${pullRequest.repo}/${pullRequest.number}`}
                      media={<View style={[styles.dot, { backgroundColor: pullRequest.state === 'open' ? theme.info : theme.dimForeground }]} />}
                      monospaceDescription
                      onPress={() => onOpen(pullRequest)}
                      title={pullRequest.title}
                    />
                  ))}
                </View>
              ))}
            </View>
          )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: 4,
    height: 8,
    marginTop: 5,
    width: 8,
  },
  group: {
    marginBottom: spacing.md,
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segmented: {
    marginBottom: spacing.sm,
    minHeight: 36,
  },
  search: {
    marginBottom: spacing.lg,
  },
  time: {

    fontSize: 11,
    fontVariant: ['tabular-nums'],
    marginLeft: 'auto',
  },
})
