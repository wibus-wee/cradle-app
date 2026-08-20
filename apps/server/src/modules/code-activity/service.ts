import { AppError } from '../../errors/app-error'
import { subscribeWorkspaceFileChanges } from '../workspace/file-watch'
import * as Workspace from '../workspace/service'
import { resolveSessionExecutionRootById } from '../worktree/service'

interface CodeActivityWorkspace {
  id: string
  name: string
}

function resolveSessionCodeActivitySource(sessionId: string): {
  rootPath: string
  workspace: CodeActivityWorkspace
} {
  const execution = resolveSessionExecutionRootById(sessionId)
  if (!execution) {
    throw new AppError({
      code: 'code_activity_session_not_found',
      status: 404,
      message: 'Chat session was not found.',
    })
  }
  if (!execution.sourceWorkspaceId || !execution.rootPath) {
    throw new AppError({
      code: 'code_activity_execution_root_unavailable',
      status: 409,
      message: 'The chat session does not have a local execution root.',
    })
  }

  const workspace = Workspace.get(execution.sourceWorkspaceId)
  if (!workspace) {
    throw new AppError({
      code: 'code_activity_workspace_not_found',
      status: 409,
      message: 'The chat session workspace was not found.',
    })
  }

  return {
    rootPath: execution.rootPath,
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
  }
}

export function openSessionEvents(sessionId: string): ReadableStream<Uint8Array> {
  const { rootPath, workspace } = resolveSessionCodeActivitySource(sessionId)
  const encoder = new TextEncoder()
  let unsubscribe = () => {}
  let keepAlive: NodeJS.Timeout | null = null

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      send({
        type: 'ready',
        sessionId,
        workspace,
        occurredAt: Date.now(),
      })
      unsubscribe = subscribeWorkspaceFileChanges({
        workspaceId: workspace.id,
        workspacePath: rootPath,
        listener(event) {
          if (event.type !== 'file-changed') {
            return
          }
          send({
            type: 'file-changed',
            sessionId,
            workspace,
            file: { relativePath: event.path },
            occurredAt: event.timestamp,
          })
        },
      })
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        }
        catch {
          unsubscribe()
          if (keepAlive) {
            clearInterval(keepAlive)
            keepAlive = null
          }
        }
      }, 15000)
    },
    cancel() {
      unsubscribe()
      if (keepAlive) {
        clearInterval(keepAlive)
        keepAlive = null
      }
    },
  })
}
