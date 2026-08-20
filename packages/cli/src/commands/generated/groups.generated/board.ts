import type { Command } from 'commander'

import { register as registerBoardCreate } from '../board/create'
import { register as registerBoardDelete } from '../board/delete'
import { register as registerBoardList } from '../board/list'
import { register as registerBoardUpdate } from '../board/update'

export function registerGeneratedCommands(program: Command): void {
  registerBoardCreate(program)
  registerBoardDelete(program)
  registerBoardList(program)
  registerBoardUpdate(program)
}
