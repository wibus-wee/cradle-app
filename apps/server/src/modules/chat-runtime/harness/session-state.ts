import { createHash } from 'node:crypto'

import type { RuntimeHarnessFragment } from '@cradle/chat-runtime-contracts'
import type { Session } from '@cradle/db'

const SESSION_HARNESS_FRAGMENT_KEY = 'cradle-session'
const SESSION_HARNESS_FRAGMENT_VERSION = 1

export function resolveSessionStateHarnessFragment(session: Session): RuntimeHarnessFragment {
  const payload = JSON.stringify({
    authority: 'cradle',
    user_authored: false,
    session: {
      session_id: session.id,
      workspace_id: session.workspaceId,
      runtime_kind: session.runtimeKind,
      provider_target_id: session.providerTargetId,
      agent_id: session.agentId,
      origin: session.origin,
      parent_session_id: session.parentSessionId,
      side_context_source: session.sideContextSource,
      session_group_id: session.sessionGroupId,
      linked_issue_id: session.linkedIssueId,
      worktree_id: session.worktreeId,
    },
  }, null, 2)
  const contentRevision = createHash('sha256').update(payload).digest('hex').slice(0, 12)
  const revision = `${SESSION_HARNESS_FRAGMENT_KEY}:${session.id}:v${SESSION_HARNESS_FRAGMENT_VERSION}:${contentRevision}`

  return {
    key: SESSION_HARNESS_FRAGMENT_KEY,
    revision,
    content: [
      `<cradle_session_state revision="${revision}">`,
      payload,
      '</cradle_session_state>',
    ].join('\n'),
  }
}
