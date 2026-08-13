import type { Command } from 'commander'

import { register as registerPullRequestAssignableUsers } from '../pull-request/assignable-users'
import { register as registerPullRequestAssignees } from '../pull-request/assignees'
import { register as registerPullRequestAuthored } from '../pull-request/authored'
import { register as registerPullRequestComment } from '../pull-request/comment'
import { register as registerPullRequestDetail } from '../pull-request/detail'
import { register as registerPullRequestDetailRefresh } from '../pull-request/detail/refresh'
import { register as registerPullRequestDraft } from '../pull-request/draft'
import { register as registerPullRequestFingerprint } from '../pull-request/fingerprint'
import { register as registerPullRequestFingerprintProbe } from '../pull-request/fingerprint/probe'
import { register as registerPullRequestMerge } from '../pull-request/merge'
import { register as registerPullRequestReady } from '../pull-request/ready'
import { register as registerPullRequestRefresh } from '../pull-request/refresh'
import { register as registerPullRequestReview } from '../pull-request/review'
import { register as registerPullRequestReviewers } from '../pull-request/reviewers'
import { register as registerPullRequestReviewing } from '../pull-request/reviewing'
import { register as registerPullRequestViewer } from '../pull-request/viewer'

export function registerGeneratedCommands(program: Command): void {
  registerPullRequestAssignableUsers(program)
  registerPullRequestAssignees(program)
  registerPullRequestAuthored(program)
  registerPullRequestComment(program)
  registerPullRequestDetail(program)
  registerPullRequestDetailRefresh(program)
  registerPullRequestDraft(program)
  registerPullRequestFingerprint(program)
  registerPullRequestFingerprintProbe(program)
  registerPullRequestMerge(program)
  registerPullRequestReady(program)
  registerPullRequestRefresh(program)
  registerPullRequestReview(program)
  registerPullRequestReviewers(program)
  registerPullRequestReviewing(program)
  registerPullRequestViewer(program)
}
