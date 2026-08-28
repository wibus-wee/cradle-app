import type { Command } from 'commander'

import { register as registerChatAuthRecoveryCancel } from '../chat/auth-recovery/cancel'
import { register as registerChatAuthRecoveryGet } from '../chat/auth-recovery/get'
import { register as registerChatAuthRecoveryRetry } from '../chat/auth-recovery/retry'
import { register as registerChatCancel } from '../chat/cancel'
import { register as registerChatHandoffCreate } from '../chat/handoff/create'
import { register as registerChatHandoffGet } from '../chat/handoff/get'
import { register as registerChatMessages } from '../chat/messages'
import { register as registerChatQueue } from '../chat/queue'
import { register as registerChatQueueAdd } from '../chat/queue/add'
import { register as registerChatQueueCancel } from '../chat/queue/cancel'
import { register as registerChatQueueReorder } from '../chat/queue/reorder'
import { register as registerChatQueueUpdate } from '../chat/queue/update'
import { register as registerChatRuntimeSettingsGet } from '../chat/runtime-settings/get'
import { register as registerChatRuntimeSettingsSet } from '../chat/runtime-settings/set'
import { register as registerChatSessionCheckpointList } from '../chat/session/checkpoint/list'
import { register as registerChatSessionCheckpointRestore } from '../chat/session/checkpoint/restore'
import { register as registerChatSessionCheckpointRewind } from '../chat/session/checkpoint/rewind'
import { register as registerChatSessionEnvironment } from '../chat/session/environment'
import { register as registerChatSessionRollbackLastTurn } from '../chat/session/rollback-last-turn'
import { register as registerChatSnapshotRun } from '../chat/snapshot/run'
import { register as registerChatSnapshotSession } from '../chat/snapshot/session'
import { register as registerChatTraceRun } from '../chat/trace/run'
import { register as registerChatTraceSession } from '../chat/trace/session'

export function registerGeneratedCommands(program: Command): void {
  registerChatAuthRecoveryCancel(program)
  registerChatAuthRecoveryGet(program)
  registerChatAuthRecoveryRetry(program)
  registerChatCancel(program)
  registerChatHandoffCreate(program)
  registerChatHandoffGet(program)
  registerChatMessages(program)
  registerChatQueue(program)
  registerChatQueueAdd(program)
  registerChatQueueCancel(program)
  registerChatQueueReorder(program)
  registerChatQueueUpdate(program)
  registerChatRuntimeSettingsGet(program)
  registerChatRuntimeSettingsSet(program)
  registerChatSessionCheckpointList(program)
  registerChatSessionCheckpointRestore(program)
  registerChatSessionCheckpointRewind(program)
  registerChatSessionEnvironment(program)
  registerChatSessionRollbackLastTurn(program)
  registerChatSnapshotRun(program)
  registerChatSnapshotSession(program)
  registerChatTraceRun(program)
  registerChatTraceSession(program)
}
