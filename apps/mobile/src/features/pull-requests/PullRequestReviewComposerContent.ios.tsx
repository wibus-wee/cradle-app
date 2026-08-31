import {
  Button,
  ConfirmationDialog,
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
  textFieldStyle,
} from '@expo/ui/swift-ui/modifiers'
import { useState } from 'react'

import type {
  PullRequestReviewComposerProps,
  PullRequestReviewEvent,
} from './pull-request-review-composer-contract'

const fullWidth = frame({ maxWidth: Infinity, minHeight: 44, alignment: 'leading' })

export function PullRequestReviewComposerContent({
  initialDraft = '',
  isMutating = false,
  onComment,
  onDraftChange,
  onReview,
}: PullRequestReviewComposerProps) {
  const text = useNativeState(initialDraft)
  const [comment, setComment] = useState(initialDraft)
  const [pendingAction, setPendingAction] = useState<'comment' | PullRequestReviewEvent | null>(null)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const body = comment.trim()
  const busy = isMutating || pendingAction !== null

  const clearSubmittedDraft = (submittedBody: string) => {
    setComment((current) => {
      if (current.trim() !== submittedBody) { return current }
      text.set('')
      onDraftChange?.('')
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
    <VStack alignment="leading" modifiers={[frame({ maxWidth: Infinity })]} spacing={12}>
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
          onDraftChange?.(value)
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
      <ConfirmationDialog
        title="Request changes?"
        titleVisibility="visible"
      >
        <ConfirmationDialog.Trigger>
          <Button modifiers={[buttonStyle('bordered'), disabled(!body || busy)]}>
            <HStack modifiers={[fullWidth]} spacing={10}>
              {pendingAction === 'REQUEST_CHANGES'
                ? <ProgressView />
                : <Image color="red" size={16} systemName="xmark.circle" />}
              <Text modifiers={[foregroundStyle('red')]}>Request Changes</Text>
              <Spacer />
            </HStack>
          </Button>
        </ConfirmationDialog.Trigger>
        <ConfirmationDialog.Actions>
          <Button
            label="Request Changes"
            onPress={() => void submitReview('REQUEST_CHANGES')}
            role="destructive"
            systemImage="xmark.circle"
          />
          <Button label="Cancel" role="cancel" />
        </ConfirmationDialog.Actions>
        <ConfirmationDialog.Message>
          <Text>Your note will be published and the pull request will require changes before approval.</Text>
        </ConfirmationDialog.Message>
      </ConfirmationDialog>
      <ConfirmationDialog
        title="Approve pull request?"
        titleVisibility="visible"
      >
        <ConfirmationDialog.Trigger>
          <Button modifiers={[buttonStyle('borderedProminent'), disabled(busy)]}>
            <HStack modifiers={[fullWidth]} spacing={10}>
              {pendingAction === 'APPROVE'
                ? <ProgressView />
                : <Image size={16} systemName="checkmark.circle" />}
              <Text>Approve</Text>
              <Spacer />
            </HStack>
          </Button>
        </ConfirmationDialog.Trigger>
        <ConfirmationDialog.Actions>
          <Button
            label="Approve"
            onPress={() => void submitReview('APPROVE')}
            systemImage="checkmark.circle"
          />
          <Button label="Cancel" role="cancel" />
        </ConfirmationDialog.Actions>
        <ConfirmationDialog.Message>
          <Text>
            {body
              ? 'Your note will be published with an approving review.'
              : 'This will publish an approving review without a note.'}
          </Text>
        </ConfirmationDialog.Message>
      </ConfirmationDialog>
    </VStack>
  )
}
