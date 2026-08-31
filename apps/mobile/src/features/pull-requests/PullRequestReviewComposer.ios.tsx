import {
  Button,
  Host,
  HStack,
  Image,
  ProgressView,
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
  padding,
  textFieldStyle,
} from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'

import type {
  PullRequestReviewComposerProps,
  PullRequestReviewEvent,
} from './pull-request-review-composer-contract'

export type {
  PullRequestReviewComposerProps,
  PullRequestReviewEvent,
} from './pull-request-review-composer-contract'

const fullWidth = frame({ maxWidth: Infinity, minHeight: 44, alignment: 'leading' })
const contentPadding = padding({ top: 24 })

export function PullRequestReviewComposer({
  isMutating = false,
  onComment,
  onReview,
}: PullRequestReviewComposerProps) {
  const text = useNativeState('')
  const [comment, setComment] = useState('')
  const [pendingAction, setPendingAction] = useState<'comment' | PullRequestReviewEvent | null>(null)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const body = comment.trim()
  const busy = isMutating || pendingAction !== null

  const clearSubmittedDraft = (submittedBody: string) => {
    setComment((current) => {
      if (current.trim() !== submittedBody) { return current }
      text.set('')
      return ''
    })
  }
  const submitComment = async () => {
    if (!body) { return }
    setSubmissionError(null)
    setPendingAction('comment')
    try {
      await onComment(body)
      clearSubmittedDraft(body)
    }
    catch {
      setSubmissionError('Could not add comment. Your text has been preserved.')
    }
    finally {
      setPendingAction(null)
    }
  }
  const submitReview = async (event: PullRequestReviewEvent) => {
    if (event === 'REQUEST_CHANGES' && !body) { return }
    setSubmissionError(null)
    setPendingAction(event)
    try {
      await onReview(event, body)
      clearSubmittedDraft(body)
    }
    catch {
      setSubmissionError('Could not submit review. Your text has been preserved.')
    }
    finally {
      setPendingAction(null)
    }
  }

  return (
    <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
      <VStack alignment="leading" modifiers={[contentPadding, frame({ maxWidth: Infinity })]} spacing={12}>
        <VStack alignment="leading" spacing={3}>
          <Text modifiers={[font({ textStyle: 'headline' })]}>Review</Text>
          <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>
            Add an optional note, comment, approve, or request changes.
          </Text>
        </VStack>

        <TextField
          axis="vertical"
          modifiers={[
            lineLimit({ min: 4, max: 10 }),
            textFieldStyle('roundedBorder'),
            disabled(busy),
          ]}
          onTextChange={(value) => {
            setSubmissionError(null)
            setComment(value)
          }}
          placeholder="Review note"
          text={text}
        />

        {submissionError && (
          <HStack spacing={8}>
            <Image color="red" size={16} systemName="exclamationmark.circle.fill" />
            <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('red')]}>
              {submissionError}
            </Text>
          </HStack>
        )}

        <Button
          modifiers={[buttonStyle('bordered'), disabled(!body || busy)]}
          onPress={() => void submitComment()}
        >
          <HStack modifiers={[fullWidth]} spacing={10}>
            {pendingAction === 'comment'
              ? <ProgressView />
              : <Image size={16} systemName="text.bubble" />}
            <Text>Comment</Text>
            <Spacer />
          </HStack>
        </Button>
        <Button
          modifiers={[buttonStyle('bordered'), disabled(!body || busy)]}
          onPress={() => void submitReview('REQUEST_CHANGES')}
        >
          <HStack modifiers={[fullWidth]} spacing={10}>
            {pendingAction === 'REQUEST_CHANGES'
              ? <ProgressView />
              : <Image color="red" size={16} systemName="xmark.circle" />}
            <Text modifiers={[foregroundStyle('red')]}>Request Changes</Text>
            <Spacer />
          </HStack>
        </Button>
        <Button
          modifiers={[buttonStyle('borderedProminent'), disabled(busy)]}
          onPress={() => void submitReview('APPROVE')}
        >
          <HStack modifiers={[fullWidth]} spacing={10}>
            {pendingAction === 'APPROVE'
              ? <ProgressView />
              : <Image size={16} systemName="checkmark.circle" />}
            <Text>Approve</Text>
            <Spacer />
          </HStack>
        </Button>
      </VStack>
    </Host>
  )
}
