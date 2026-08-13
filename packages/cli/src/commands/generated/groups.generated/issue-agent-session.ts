import type { Command } from 'commander'

import { register as registerIssueAgentSessionActivities } from '../issue-agent-session/activities'
import { register as registerIssueAgentSessionRerun } from '../issue-agent-session/rerun'
import { register as registerIssueAgentSessionStop } from '../issue-agent-session/stop'

export function registerGeneratedCommands(program: Command): void {
  registerIssueAgentSessionActivities(program)
  registerIssueAgentSessionRerun(program)
  registerIssueAgentSessionStop(program)
}
