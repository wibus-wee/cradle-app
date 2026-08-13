import type { Command } from 'commander'

import { register as registerWorkflowRuleDelete } from '../workflow-rule/delete'
import { register as registerWorkflowRuleGet } from '../workflow-rule/get'
import { register as registerWorkflowRuleList } from '../workflow-rule/list'
import { register as registerWorkflowRuleSave } from '../workflow-rule/save'

export function registerGeneratedCommands(program: Command): void {
  registerWorkflowRuleDelete(program)
  registerWorkflowRuleGet(program)
  registerWorkflowRuleList(program)
  registerWorkflowRuleSave(program)
}
