import type { Command } from 'commander'

import { register as registerAutomationArtifactGet } from '../automation/artifact/get'
import { register as registerAutomationArtifactList } from '../automation/artifact/list'
import { register as registerAutomationArtifacts } from '../automation/artifacts'
import { register as registerAutomationCreate } from '../automation/create'
import { register as registerAutomationDelete } from '../automation/delete'
import { register as registerAutomationDisable } from '../automation/disable'
import { register as registerAutomationEnable } from '../automation/enable'
import { register as registerAutomationGet } from '../automation/get'
import { register as registerAutomationList } from '../automation/list'
import { register as registerAutomationRun } from '../automation/run'
import { register as registerAutomationRunGet } from '../automation/run/get'
import { register as registerAutomationRunStop } from '../automation/run/stop'
import { register as registerAutomationRunTriage } from '../automation/run/triage'
import { register as registerAutomationRuns } from '../automation/runs'
import { register as registerAutomationTriageList } from '../automation/triage/list'
import { register as registerAutomationUpdate } from '../automation/update'

export function registerGeneratedCommands(program: Command): void {
  registerAutomationArtifactGet(program)
  registerAutomationArtifactList(program)
  registerAutomationArtifacts(program)
  registerAutomationCreate(program)
  registerAutomationDelete(program)
  registerAutomationDisable(program)
  registerAutomationEnable(program)
  registerAutomationGet(program)
  registerAutomationList(program)
  registerAutomationRun(program)
  registerAutomationRunGet(program)
  registerAutomationRunStop(program)
  registerAutomationRunTriage(program)
  registerAutomationRuns(program)
  registerAutomationTriageList(program)
  registerAutomationUpdate(program)
}
