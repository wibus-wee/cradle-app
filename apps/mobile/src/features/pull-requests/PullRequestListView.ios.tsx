import {
  Button,
  Host,
  HStack,
  Image,
  List,
  Picker,
  Section,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  listStyle,
  monospacedDigit,
  pickerStyle,
  refreshable,
  tag,
} from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'

import { NativeUnavailableView } from '@/components/ui/native-unavailable-view.ios'
import { relativeTime } from '@/lib/format'

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

type PullRequestMode = 'authored' | 'reviewing'

const fullWidth = frame({ maxWidth: Infinity, minHeight: 44, alignment: 'leading' })
const plainButton = buttonStyle('plain')
const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const tabularNumber = monospacedDigit()

function checkPresentation(state: PullRequestListItem['checksState']) {
  if (state === 'success') {
    return { color: 'green' as const, label: 'Passed', symbol: 'checkmark.circle.fill' as const }
  }
  if (state === 'failure') {
    return { color: 'red' as const, label: 'Failed', symbol: 'xmark.circle.fill' as const }
  }
  if (state === 'pending') {
    return { color: 'orange' as const, label: 'Pending', symbol: 'clock.fill' as const }
  }
  return { color: 'secondary' as const, label: 'No checks', symbol: 'circle.dotted' as const }
}

export function PullRequestListView({
  authored,
  login,
  onOpen,
  onRefresh,
  reviewing,
  searchQuery,
}: PullRequestListViewProps) {
  const [mode, setMode] = useState<PullRequestMode>('authored')
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
  const sourceItems = mode === 'authored' ? authored : reviewing
  const items = normalizedSearch
    ? sourceItems.filter(item => pullRequestMatchesSearch(item, normalizedSearch))
    : sourceItems
  const groups = pullRequestGroupTitles
    .map(title => ({ title, items: items.filter(item => pullRequestGroup(item.updatedAt) === title) }))
    .filter(group => group.items.length > 0)
  const listModifiers = [
    listStyle('insetGrouped'),
    ...(onRefresh ? [refreshable(async () => { await onRefresh() })] : []),
  ]

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <List modifiers={listModifiers}>
        <Section footer={<Text modifiers={[secondaryForeground]}>{`Signed in as @${login}`}</Text>}>
          <Picker<PullRequestMode>
            modifiers={[pickerStyle('segmented')]}
            onSelectionChange={setMode}
            selection={mode}
          >
            <Text modifiers={[tag('authored')]}>Authored</Text>
            <Text modifiers={[tag('reviewing')]}>Review Requests</Text>
          </Picker>
        </Section>

        {groups.map(group => (
          <Section key={group.title} title={group.title}>
            {group.items.map((pullRequest) => {
              const checks = checkPresentation(pullRequest.checksState)
              return (
                <Button
                  key={`${pullRequest.owner}/${pullRequest.repo}/${pullRequest.number}`}
                  modifiers={[plainButton]}
                  onPress={() => onOpen(pullRequest)}
                >
                  <HStack modifiers={[fullWidth]} spacing={12}>
                    <Image color={checks.color} size={18} systemName={checks.symbol} />
                    <VStack alignment="leading" spacing={4}>
                      <Text>{pullRequest.title}</Text>
                      <Text
                        modifiers={[
                          font({ design: 'monospaced', textStyle: 'caption' }),
                          secondaryForeground,
                        ]}
                      >
                        {`${pullRequest.owner}/${pullRequest.repo} #${pullRequest.number}`}
                      </Text>
                      <HStack spacing={7}>
                        <Text
                          modifiers={[
                            font({ textStyle: 'caption' }),
                            foregroundStyle(pullRequest.isDraft ? 'orange' : 'secondary'),
                          ]}
                        >
                          {pullRequest.isDraft ? 'Draft' : pullRequest.state}
                        </Text>
                        <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                          {checks.label}
                        </Text>
                        <Text
                          modifiers={[
                            font({ textStyle: 'caption' }),
                            secondaryForeground,
                            tabularNumber,
                          ]}
                        >
                          {relativeTime(pullRequest.updatedAt)}
                        </Text>
                      </HStack>
                    </VStack>
                    <Spacer />
                    <Image color="secondary" size={14} systemName="chevron.forward" />
                  </HStack>
                </Button>
              )
            })}
          </Section>
        ))}

        {items.length === 0 && (
          <NativeUnavailableView
            description={normalizedSearch
              ? 'Try a different title, repository, owner, or number.'
              : mode === 'authored'
                ? 'Your open pull requests will appear here.'
                : 'You have no pending review requests.'}
            systemImage={normalizedSearch ? 'magnifyingglass' : 'tray'}
            title={normalizedSearch ? 'No Matching Pull Requests' : 'Inbox Clear'}
          />
        )}
      </List>
    </Host>
  )
}
