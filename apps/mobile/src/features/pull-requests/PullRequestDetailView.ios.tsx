import {
  Button,
  ContentUnavailableView,
  Host,
  HStack,
  Image,
  LabeledContent,
  List,
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
  textSelection,
} from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'
import { Alert } from 'react-native'

import { relativeTime } from '@/lib/format'

import type { PullRequestDetailViewProps } from './pull-request-detail-view-contract'
import { PullRequestReviewComposerContent } from './PullRequestReviewComposerContent.ios'

export type { PullRequestDetailViewProps } from './pull-request-detail-view-contract'

const fullWidth = frame({ maxWidth: Infinity, minHeight: 44, alignment: 'leading' })
const plainButton = buttonStyle('plain')
const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const tabularNumber = monospacedDigit()

function pullRequestPresentation(pullRequest: PullRequestDetailViewProps['detail']['pullRequest']) {
  if (pullRequest.merged) {
    return { color: 'purple' as const, label: 'Merged', symbol: 'arrow.triangle.merge' as const }
  }
  if (pullRequest.isDraft) {
    return { color: 'orange' as const, label: 'Draft', symbol: 'doc.badge.clock' as const }
  }
  if (pullRequest.state === 'open') {
    return { color: 'green' as const, label: 'Open', symbol: 'arrow.triangle.pull' as const }
  }
  return { color: 'secondary' as const, label: 'Closed', symbol: 'xmark.circle.fill' as const }
}

function checkPresentation(conclusion: string | null, status: string) {
  if (conclusion === 'success') {
    return { color: 'green' as const, label: 'Passed', symbol: 'checkmark.circle.fill' as const }
  }
  if (conclusion === 'failure' || conclusion === 'cancelled' || conclusion === 'timed_out') {
    return { color: 'red' as const, label: conclusion, symbol: 'xmark.circle.fill' as const }
  }
  if (status === 'queued' || status === 'in_progress') {
    return { color: 'orange' as const, label: status.replace('_', ' '), symbol: 'clock.fill' as const }
  }
  return { color: 'secondary' as const, label: conclusion ?? status, symbol: 'minus.circle' as const }
}

export function PullRequestDetailView({
  detail,
  isMutating = false,
  onComment,
  onOpenExternal,
  onReview,
}: PullRequestDetailViewProps) {
  const [showAllTimeline, setShowAllTimeline] = useState(false)
  const { pullRequest } = detail
  const status = pullRequestPresentation(pullRequest)
  const visibleTimeline = showAllTimeline ? detail.timeline : detail.timeline.slice(-20)

  const openExternal = async (url: string, failureMessage: string) => {
    try {
      await onOpenExternal(url)
    }
    catch {
      Alert.alert(failureMessage)
    }
  }

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <List modifiers={[listStyle('insetGrouped')]}>
        <Section
          footer={(
            <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
              {`${pullRequest.headRef} → ${pullRequest.baseRef}`}
            </Text>
          )}
        >
          <VStack alignment="leading" spacing={7}>
            <Text modifiers={[font({ textStyle: 'headline' }), textSelection(true)]}>
              {pullRequest.title}
            </Text>
            <Text
              modifiers={[
                font({ design: 'monospaced', textStyle: 'caption' }),
                secondaryForeground,
                textSelection(true),
              ]}
            >
              {`${pullRequest.owner}/${pullRequest.repo} #${pullRequest.number}`}
            </Text>
            <HStack spacing={7}>
              <Image color={status.color} size={16} systemName={status.symbol} />
              <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(status.color)]}>
                {status.label}
              </Text>
              <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                {`updated ${relativeTime(pullRequest.updatedAt)}`}
              </Text>
            </HStack>
          </VStack>
        </Section>

        <Section title="Changes">
          <LabeledContent label="Additions">
            <Text modifiers={[foregroundStyle('green'), tabularNumber]}>{`+${pullRequest.additions}`}</Text>
          </LabeledContent>
          <LabeledContent label="Deletions">
            <Text modifiers={[foregroundStyle('red'), tabularNumber]}>{`−${pullRequest.deletions}`}</Text>
          </LabeledContent>
          <LabeledContent label="Files">
            <Text modifiers={[tabularNumber]}>{pullRequest.changedFiles.toString()}</Text>
          </LabeledContent>
          <LabeledContent label="Commits">
            <Text modifiers={[tabularNumber]}>{pullRequest.commits.toString()}</Text>
          </LabeledContent>
        </Section>

        {pullRequest.body && (
          <Section title="Description">
            <Text markdownEnabled modifiers={[textSelection(true)]}>{pullRequest.body}</Text>
          </Section>
        )}

        {pullRequest.labels.length > 0 && (
          <Section title="Labels">
            {pullRequest.labels.map(label => (
              <HStack key={label.name} spacing={10}>
                <Image color={`#${label.color}`} size={12} systemName="circle.fill" />
                <Text>{label.name}</Text>
              </HStack>
            ))}
          </Section>
        )}

        <Section title={`Checks (${pullRequest.checks.length})`}>
          {pullRequest.checks.map((check) => {
            const presentation = checkPresentation(check.conclusion, check.status)
            const content = (
              <HStack modifiers={[fullWidth]} spacing={10}>
                <Image color={presentation.color} size={17} systemName={presentation.symbol} />
                <VStack alignment="leading" spacing={2}>
                  <Text>{check.name}</Text>
                  <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                    {presentation.label}
                  </Text>
                </VStack>
                <Spacer />
                {check.url && <Image color="secondary" size={14} systemName="arrow.up.right" />}
              </HStack>
            )
            return check.url
              ? (
                  <Button
                    key={check.id}
                    modifiers={[plainButton]}
                    onPress={() => void openExternal(check.url!, 'Could not open check details')}
                  >
                    {content}
                  </Button>
                )
              : <VStack key={check.id}>{content}</VStack>
          })}
          {pullRequest.checks.length === 0 && (
            <Text modifiers={[secondaryForeground]}>No checks reported.</Text>
          )}
        </Section>

        <Section title={`Changed Files (${detail.files.length})`}>
          {detail.files.map(file => (
            <Button
              key={file.sha + file.filename}
              modifiers={[plainButton]}
              onPress={() => void openExternal(file.blobUrl, 'Could not open changed file')}
            >
              <HStack modifiers={[fullWidth]} spacing={10}>
                <Image color="secondary" size={17} systemName="doc.text" />
                <VStack alignment="leading" spacing={3}>
                  <Text modifiers={[textSelection(true)]}>{file.filename}</Text>
                  <HStack spacing={7}>
                    <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                      {file.status}
                    </Text>
                    <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle('green'), tabularNumber]}>
                      {`+${file.additions}`}
                    </Text>
                    <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle('red'), tabularNumber]}>
                      {`−${file.deletions}`}
                    </Text>
                  </HStack>
                </VStack>
                <Spacer />
                <Image color="secondary" size={14} systemName="arrow.up.right" />
              </HStack>
            </Button>
          ))}
          {detail.files.length === 0 && (
            <Text modifiers={[secondaryForeground]}>No changed files reported.</Text>
          )}
        </Section>

        <Section title={`Conversation (${detail.timeline.length})`}>
          {detail.timeline.length > 20 && (
            <Button
              onPress={() => setShowAllTimeline(current => !current)}
            >
              <HStack modifiers={[fullWidth]} spacing={10}>
                <Image size={16} systemName={showAllTimeline ? 'arrow.down.to.line' : 'clock.arrow.circlepath'} />
                <Text>
                  {showAllTimeline
                    ? 'Show Latest 20'
                    : `Show ${detail.timeline.length - 20} Earlier Events`}
                </Text>
                <Spacer />
              </HStack>
            </Button>
          )}
          {visibleTimeline.map((item) => {
            const content = (
              <HStack modifiers={[fullWidth]} spacing={10}>
                <Image color="secondary" size={17} systemName={item.kind === 'review' ? 'checkmark.bubble' : 'text.bubble'} />
                <VStack alignment="leading" spacing={4}>
                  <HStack spacing={6}>
                    <Text modifiers={[font({ textStyle: 'subheadline' })]}>
                      {item.author?.login ?? 'Unknown'}
                    </Text>
                    {item.state && (
                      <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                        {item.state.toLocaleLowerCase()}
                      </Text>
                    )}
                  </HStack>
                  {item.body && <Text markdownEnabled>{item.body}</Text>}
                  <Text modifiers={[font({ textStyle: 'caption' }), secondaryForeground]}>
                    {relativeTime(Date.parse(item.createdAt) / 1000)}
                  </Text>
                </VStack>
                <Spacer />
                {item.url && <Image color="secondary" size={14} systemName="arrow.up.right" />}
              </HStack>
            )
            return item.url
              ? (
                  <Button
                    key={item.id}
                    modifiers={[plainButton]}
                    onPress={() => void openExternal(item.url!, 'Could not open conversation event')}
                  >
                    {content}
                  </Button>
                )
              : <VStack key={item.id}>{content}</VStack>
          })}
          {detail.timeline.length === 0 && (
            <ContentUnavailableView
              description="Comments and reviews will appear here."
              systemImage="bubble.left.and.bubble.right"
              title="No Conversation Yet"
            />
          )}
        </Section>

        <Section
          footer={(
            <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
              Add an optional note, comment, approve, or request changes.
            </Text>
          )}
          title="Review"
        >
          <PullRequestReviewComposerContent
            isMutating={isMutating}
            onComment={onComment}
            onReview={onReview}
          />
        </Section>
      </List>
    </Host>
  )
}
