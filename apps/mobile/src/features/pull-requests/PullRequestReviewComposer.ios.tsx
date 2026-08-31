import {
  Host,
  Text,
  VStack,
} from '@expo/ui/swift-ui'
import {
  font,
  foregroundStyle,
  frame,
  padding,
} from '@expo/ui/swift-ui/modifiers'

import type { PullRequestReviewComposerProps } from './pull-request-review-composer-contract'
import { PullRequestReviewComposerContent } from './PullRequestReviewComposerContent.ios'

export type {
  PullRequestReviewComposerProps,
  PullRequestReviewEvent,
} from './pull-request-review-composer-contract'

const contentPadding = padding({ top: 24 })

export function PullRequestReviewComposer(props: PullRequestReviewComposerProps) {
  return (
    <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
      <VStack alignment="leading" modifiers={[contentPadding, frame({ maxWidth: Infinity })]} spacing={12}>
        <VStack alignment="leading" spacing={3}>
          <Text modifiers={[font({ textStyle: 'headline' })]}>Review</Text>
          <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>
            Add an optional note, comment, approve, or request changes.
          </Text>
        </VStack>
        <PullRequestReviewComposerContent {...props} />
      </VStack>
    </Host>
  )
}
