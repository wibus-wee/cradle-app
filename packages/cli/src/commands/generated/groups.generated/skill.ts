import type { Command } from 'commander'

import { register as registerSkillCreate } from '../skill/create'
import { register as registerSkillDocumentDelete } from '../skill/document/delete'
import { register as registerSkillDocumentGet } from '../skill/document/get'
import { register as registerSkillDocumentUpdate } from '../skill/document/update'
import { register as registerSkillExport } from '../skill/export'
import { register as registerSkillImport } from '../skill/import'
import { register as registerSkillList } from '../skill/list'
import { register as registerSkillSourceCancelFetch } from '../skill/source/cancel-fetch'
import { register as registerSkillSourceFetch } from '../skill/source/fetch'
import { register as registerSkillSourceImport } from '../skill/source/import'

export function registerGeneratedCommands(program: Command): void {
  registerSkillCreate(program)
  registerSkillDocumentDelete(program)
  registerSkillDocumentGet(program)
  registerSkillDocumentUpdate(program)
  registerSkillExport(program)
  registerSkillImport(program)
  registerSkillList(program)
  registerSkillSourceCancelFetch(program)
  registerSkillSourceFetch(program)
  registerSkillSourceImport(program)
}
