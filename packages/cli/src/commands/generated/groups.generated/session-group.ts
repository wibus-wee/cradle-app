import type { Command } from 'commander'

import { register as registerSessionGroupAddMember } from '../session-group/add-member'
import { register as registerSessionGroupCreate } from '../session-group/create'
import { register as registerSessionGroupDelete } from '../session-group/delete'
import { register as registerSessionGroupGet } from '../session-group/get'
import { register as registerSessionGroupList } from '../session-group/list'
import { register as registerSessionGroupRemoveMember } from '../session-group/remove-member'
import { register as registerSessionGroupUpdate } from '../session-group/update'

export function registerGeneratedCommands(program: Command): void {
  registerSessionGroupAddMember(program)
  registerSessionGroupCreate(program)
  registerSessionGroupDelete(program)
  registerSessionGroupGet(program)
  registerSessionGroupList(program)
  registerSessionGroupRemoveMember(program)
  registerSessionGroupUpdate(program)
}
