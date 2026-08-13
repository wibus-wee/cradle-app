import type { Command } from 'commander'

import { register as registerExternalIssueSourceBind } from '../external-issue-source/bind'
import { register as registerExternalIssueSourceBindingDelete } from '../external-issue-source/binding/delete'
import { register as registerExternalIssueSourceBindingList } from '../external-issue-source/binding/list'
import { register as registerExternalIssueSourceBindingUpdate } from '../external-issue-source/binding/update'
import { register as registerExternalIssueSourceItemList } from '../external-issue-source/item/list'
import { register as registerExternalIssueSourceItemMove } from '../external-issue-source/item/move'
import { register as registerExternalIssueSourceList } from '../external-issue-source/list'
import { register as registerExternalIssueSourceRefresh } from '../external-issue-source/refresh'
import { register as registerExternalIssueSourceRefreshSource } from '../external-issue-source/refresh-source'

export function registerGeneratedCommands(program: Command): void {
  registerExternalIssueSourceBind(program)
  registerExternalIssueSourceBindingDelete(program)
  registerExternalIssueSourceBindingList(program)
  registerExternalIssueSourceBindingUpdate(program)
  registerExternalIssueSourceItemList(program)
  registerExternalIssueSourceItemMove(program)
  registerExternalIssueSourceList(program)
  registerExternalIssueSourceRefresh(program)
  registerExternalIssueSourceRefreshSource(program)
}
