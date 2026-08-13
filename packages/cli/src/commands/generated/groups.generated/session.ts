import type { Command } from 'commander'

import { register as registerSessionArchive } from '../session/archive'
import { register as registerSessionAwaitCancel } from '../session/await-cancel'
import { register as registerSessionAwaitCreate } from '../session/await-create'
import { register as registerSessionAwaitGet } from '../session/await-get'
import { register as registerSessionAwaitList } from '../session/await-list'
import { register as registerSessionAwaitRetryDelivery } from '../session/await-retry-delivery'
import { register as registerSessionAwaitSummary } from '../session/await-summary'
import { register as registerSessionAwaitTrigger } from '../session/await-trigger'
import { register as registerSessionCreate } from '../session/create'
import { register as registerSessionDelete } from '../session/delete'
import { register as registerSessionExportMarkdown } from '../session/export/markdown'
import { register as registerSessionExportZip } from '../session/export/zip'
import { register as registerSessionGet } from '../session/get'
import { register as registerSessionIsolationActivate } from '../session/isolation/activate'
import { register as registerSessionIsolationCancel } from '../session/isolation/cancel'
import { register as registerSessionIsolationLeave } from '../session/isolation/leave'
import { register as registerSessionIsolationRepair } from '../session/isolation/repair'
import { register as registerSessionIsolationStart } from '../session/isolation/start'
import { register as registerSessionLinkedIssueGet } from '../session/linked-issue/get'
import { register as registerSessionLinkedIssueLink } from '../session/linked-issue/link'
import { register as registerSessionLinkedIssueUnlink } from '../session/linked-issue/unlink'
import { register as registerSessionList } from '../session/list'
import { register as registerSessionPullRequestCreate } from '../session/pull-request/create'
import { register as registerSessionPullRequestDetail } from '../session/pull-request/detail'
import { register as registerSessionPullRequestGet } from '../session/pull-request/get'
import { register as registerSessionPullRequestReady } from '../session/pull-request/ready'
import { register as registerSessionUpdate } from '../session/update'

export function registerGeneratedCommands(program: Command): void {
  registerSessionArchive(program)
  registerSessionAwaitCancel(program)
  registerSessionAwaitCreate(program)
  registerSessionAwaitGet(program)
  registerSessionAwaitList(program)
  registerSessionAwaitRetryDelivery(program)
  registerSessionAwaitSummary(program)
  registerSessionAwaitTrigger(program)
  registerSessionCreate(program)
  registerSessionDelete(program)
  registerSessionExportMarkdown(program)
  registerSessionExportZip(program)
  registerSessionGet(program)
  registerSessionIsolationActivate(program)
  registerSessionIsolationCancel(program)
  registerSessionIsolationLeave(program)
  registerSessionIsolationRepair(program)
  registerSessionIsolationStart(program)
  registerSessionLinkedIssueGet(program)
  registerSessionLinkedIssueLink(program)
  registerSessionLinkedIssueUnlink(program)
  registerSessionList(program)
  registerSessionPullRequestCreate(program)
  registerSessionPullRequestDetail(program)
  registerSessionPullRequestGet(program)
  registerSessionPullRequestReady(program)
  registerSessionUpdate(program)
}
