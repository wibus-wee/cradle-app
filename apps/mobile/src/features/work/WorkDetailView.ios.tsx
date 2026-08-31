import {
  Button,
  Form,
  Host,
  HStack,
  Image,
  LabeledContent,
  ProgressView,
  Section,
  Spacer,
  Text,
  TextField,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui'
import {
  buttonStyle,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listStyle,
  textSelection,
} from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'

import {
  hasCompleteWorkHandoff,
  initialWorkHandoff,
  workSubmissionBlocker,
} from './work-detail-model'
import type { WorkDetailViewProps, WorkHandoff } from './work-detail-view-contract'

export type { WorkDetailViewProps, WorkHandoff } from './work-detail-view-contract'

const secondaryForeground = foregroundStyle({ type: 'hierarchical', style: 'secondary' })
const fullWidth = frame({ maxWidth: Infinity, alignment: 'leading' })
const plainButton = buttonStyle('plain')

export function WorkDetailView({
  detail,
  isPreparing = false,
  isSubmitting = false,
  onOpenPullRequest,
  onPrepare,
  onSubmit,
}: WorkDetailViewProps) {
  const initialHandoff = initialWorkHandoff(detail)
  const title = useNativeState(initialHandoff.title)
  const summary = useNativeState(initialHandoff.summary)
  const testPlan = useNativeState(initialHandoff.testPlan)
  const [handoff, setHandoff] = useState<WorkHandoff>(initialHandoff)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error', text: string } | null>(null)
  const canHandoff = hasCompleteWorkHandoff(handoff)
  const submissionBlocker = workSubmissionBlocker(detail)
  const busy = isPreparing || isSubmitting

  const updateHandoff = (field: keyof WorkHandoff, value: string) => {
    setFeedback(null)
    setHandoff(current => ({ ...current, [field]: value }))
  }
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
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form modifiers={[listStyle('insetGrouped')]}>
        <Section
          footer={(
            <Text modifiers={[secondaryForeground]}>
              {detail.execution.worktreeBranch ?? 'Preparing isolated checkout'}
            </Text>
          )}
          title="Work"
        >
          <Text modifiers={[font({ textStyle: 'headline' }), textSelection(true)]}>
            {detail.work.title}
          </Text>
          <Text modifiers={[textSelection(true)]}>{detail.work.objective}</Text>
          <LabeledContent label="Activity">
            <Text
              modifiers={[
                font({ textStyle: 'footnote' }),
                foregroundStyle(detail.activity === 'running' ? 'green' : 'secondary'),
              ]}
            >
              {detail.activity}
            </Text>
          </LabeledContent>
        </Section>

        <Section title="Readiness">
          <LabeledContent label="Changed files">
            <Text>{detail.readiness.changedFiles.toString()}</Text>
          </LabeledContent>
          <LabeledContent label="Commits ahead">
            <Text>{detail.readiness.commitsAhead.toString()}</Text>
          </LabeledContent>
          <LabeledContent label="Worktree">
            <Text modifiers={[foregroundStyle(detail.readiness.clean ? 'green' : 'orange')]}>
              {detail.readiness.clean ? 'Clean' : 'Dirty'}
            </Text>
          </LabeledContent>
        </Section>

        <Section
          footer={<Text modifiers={[secondaryForeground]}>Draft metadata used when delivering this Work.</Text>}
          title="Pull Request Handoff"
        >
          <VStack alignment="leading" spacing={6}>
            <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>Title</Text>
            <TextField
              onTextChange={value => updateHandoff('title', value)}
              placeholder="Pull request title"
              text={title}
            />
          </VStack>
          <VStack alignment="leading" spacing={6}>
            <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>Summary</Text>
            <TextField
              axis="vertical"
              modifiers={[lineLimit({ min: 3, max: 8 })]}
              onTextChange={value => updateHandoff('summary', value)}
              placeholder="What changed and why"
              text={summary}
            />
          </VStack>
          <VStack alignment="leading" spacing={6}>
            <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>Test Plan</Text>
            <TextField
              axis="vertical"
              modifiers={[lineLimit({ min: 3, max: 8 })]}
              onTextChange={value => updateHandoff('testPlan', value)}
              placeholder="Verification performed"
              text={testPlan}
            />
          </VStack>
        </Section>

        <Section
          footer={submissionBlocker
            ? <Text modifiers={[foregroundStyle('orange')]}>{submissionBlocker}</Text>
            : undefined}
        >
          <Button
            modifiers={[disabled(!canHandoff || busy)]}
            onPress={() => void saveHandoff()}
          >
            <HStack modifiers={[fullWidth]} spacing={10}>
              {isPreparing
                ? <ProgressView />
                : <Image color="secondary" size={16} systemName="checkmark" />}
              <Text>{isPreparing ? 'Saving Handoff…' : 'Save Handoff'}</Text>
              <Spacer />
            </HStack>
          </Button>
          <Button
            modifiers={[disabled(!canHandoff || busy || submissionBlocker !== null)]}
            onPress={() => void submitHandoff()}
          >
            <HStack modifiers={[fullWidth]} spacing={10}>
              {isSubmitting
                ? <ProgressView />
                : <Image color="secondary" size={16} systemName="arrow.up.right" />}
              <Text>
                {isSubmitting
                  ? 'Submitting…'
                  : detail.pullRequest
                    ? 'Update Pull Request'
                    : 'Create Draft Pull Request'}
              </Text>
              <Spacer />
            </HStack>
          </Button>
        </Section>

        {feedback && (
          <Section>
            <HStack spacing={10}>
              <Image
                color={feedback.tone === 'success' ? 'green' : 'red'}
                size={17}
                systemName={feedback.tone === 'success' ? 'checkmark.circle.fill' : 'exclamationmark.circle.fill'}
              />
              <Text modifiers={[foregroundStyle(feedback.tone === 'success' ? 'green' : 'red')]}>
                {feedback.text}
              </Text>
            </HStack>
          </Section>
        )}

        {detail.pullRequest && (
          <Section title="Pull Request">
            <Button
              modifiers={[plainButton]}
              onPress={() => onOpenPullRequest(
                detail.pullRequest!.owner,
                detail.pullRequest!.repo,
                detail.pullRequest!.number,
              )}
            >
              <HStack modifiers={[fullWidth]} spacing={10}>
                <Image color="green" size={17} systemName="arrow.up.right.square" />
                <VStack alignment="leading" spacing={2}>
                  <Text>{`#${detail.pullRequest.number} ${detail.pullRequest.title}`}</Text>
                  <Text modifiers={[font({ textStyle: 'footnote' }), secondaryForeground]}>
                    {`${detail.pullRequest.isDraft ? 'Draft' : 'Ready'} · ${detail.pullRequest.state}`}
                  </Text>
                </VStack>
                <Spacer />
                <Image color="secondary" size={14} systemName="chevron.forward" />
              </HStack>
            </Button>
          </Section>
        )}
      </Form>
    </Host>
  )
}
