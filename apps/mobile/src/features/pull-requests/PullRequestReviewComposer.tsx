import { Send } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { InputGroup } from '@/components/ui/input-group'
import { NativeAction } from '@/components/ui/native-action'
import { spacing } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import type {
  PullRequestReviewComposerProps,
  PullRequestReviewEvent,
} from './pull-request-review-composer-contract'

export type {
  PullRequestReviewComposerProps,
  PullRequestReviewEvent,
} from './pull-request-review-composer-contract'

export function PullRequestReviewComposer({
  isMutating = false,
  onComment,
  onReview,
}: PullRequestReviewComposerProps) {
  const theme = useTheme()
  const [comment, setComment] = useState('')
  const [pendingAction, setPendingAction] = useState<'comment' | PullRequestReviewEvent | null>(null)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const body = comment.trim()
  const busy = isMutating || pendingAction !== null

  const clearSubmittedDraft = (submittedBody: string) => {
    setComment(current => current.trim() === submittedBody ? '' : current)
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
    <View style={styles.comment}>
      <InputGroup
        editable={!busy}
        multiline
        onChangeText={(value) => {
          setSubmissionError(null)
          setComment(value)
        }}
        placeholder="Add an optional review note..."
        value={comment}
      />
      {submissionError && (
        <Text style={[styles.submissionError, { color: theme.destructive }]}>
          {submissionError}
        </Text>
      )}
      <Button
        disabled={!body || busy}
        icon={Send}
        label="Comment"
        loading={pendingAction === 'comment'}
        onPress={() => void submitComment()}
        variant="secondary"
      />
      <View style={styles.reviewActions}>
        <NativeAction
          disabled={!body || busy}
          label="Request changes"
          loading={pendingAction === 'REQUEST_CHANGES'}
          onPress={() => void submitReview('REQUEST_CHANGES')}
          role="destructive"
          variant="outlined"
        />
        <NativeAction
          disabled={busy}
          label="Approve"
          loading={pendingAction === 'APPROVE'}
          onPress={() => void submitReview('APPROVE')}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  comment: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  reviewActions: {
    gap: spacing.sm,
  },
  submissionError: {
    fontSize: 12,
    lineHeight: 17,
  },
})
