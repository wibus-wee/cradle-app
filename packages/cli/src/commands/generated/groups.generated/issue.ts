import type { Command } from 'commander'

import { register as registerIssueActivityList } from '../issue/activity/list'
import { register as registerIssueCommentAdd } from '../issue/comment/add'
import { register as registerIssueCommentDelete } from '../issue/comment/delete'
import { register as registerIssueCommentList } from '../issue/comment/list'
import { register as registerIssueContextRefAdd } from '../issue/context-ref/add'
import { register as registerIssueContextRefRemove } from '../issue/context-ref/remove'
import { register as registerIssueCreate } from '../issue/create'
import { register as registerIssueDelegate } from '../issue/delegate'
import { register as registerIssueDelegation } from '../issue/delegation'
import { register as registerIssueDelete } from '../issue/delete'
import { register as registerIssueFieldChangeList } from '../issue/field-change/list'
import { register as registerIssueGet } from '../issue/get'
import { register as registerIssueList } from '../issue/list'
import { register as registerIssueMilestoneCreate } from '../issue/milestone/create'
import { register as registerIssueMilestoneDelete } from '../issue/milestone/delete'
import { register as registerIssueMilestoneList } from '../issue/milestone/list'
import { register as registerIssueMilestoneUpdate } from '../issue/milestone/update'
import { register as registerIssueMove } from '../issue/move'
import { register as registerIssueRelationCreate } from '../issue/relation/create'
import { register as registerIssueRelationDelete } from '../issue/relation/delete'
import { register as registerIssueRelationList } from '../issue/relation/list'
import { register as registerIssueReorder } from '../issue/reorder'
import { register as registerIssueSearch } from '../issue/search'
import { register as registerIssueSessions } from '../issue/sessions'
import { register as registerIssueStatusCreate } from '../issue/status/create'
import { register as registerIssueStatusDelete } from '../issue/status/delete'
import { register as registerIssueStatusList } from '../issue/status/list'
import { register as registerIssueStatusReorder } from '../issue/status/reorder'
import { register as registerIssueStatusUpdate } from '../issue/status/update'
import { register as registerIssueUndelegate } from '../issue/undelegate'
import { register as registerIssueUpdate } from '../issue/update'

export function registerGeneratedCommands(program: Command): void {
  registerIssueActivityList(program)
  registerIssueCommentAdd(program)
  registerIssueCommentDelete(program)
  registerIssueCommentList(program)
  registerIssueContextRefAdd(program)
  registerIssueContextRefRemove(program)
  registerIssueCreate(program)
  registerIssueDelegate(program)
  registerIssueDelegation(program)
  registerIssueDelete(program)
  registerIssueFieldChangeList(program)
  registerIssueGet(program)
  registerIssueList(program)
  registerIssueMilestoneCreate(program)
  registerIssueMilestoneDelete(program)
  registerIssueMilestoneList(program)
  registerIssueMilestoneUpdate(program)
  registerIssueMove(program)
  registerIssueRelationCreate(program)
  registerIssueRelationDelete(program)
  registerIssueRelationList(program)
  registerIssueReorder(program)
  registerIssueSearch(program)
  registerIssueSessions(program)
  registerIssueStatusCreate(program)
  registerIssueStatusDelete(program)
  registerIssueStatusList(program)
  registerIssueStatusReorder(program)
  registerIssueStatusUpdate(program)
  registerIssueUndelegate(program)
  registerIssueUpdate(program)
}
