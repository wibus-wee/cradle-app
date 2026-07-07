import { AppError } from '../../errors/app-error'
import * as Workspace from '../workspace/service'
import { getRuntimeRegistry } from './chat-runtime-provider-registry'
import type { RuntimeKind, RuntimeModelCatalog } from './runtime-provider-types'

export async function listRuntimeModels(input: {
  runtimeKind: RuntimeKind
  workspaceId?: string
}): Promise<RuntimeModelCatalog> {
  const runtime = getRuntimeRegistry().get(input.runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${input.runtimeKind}`,
    })
  }
  if (!runtime.listModels) {
    throw new AppError({
      code: 'runtime_model_catalog_unavailable',
      status: 404,
      message: `Runtime does not expose a native model catalog: ${input.runtimeKind}`,
    })
  }

  const workspacePath = input.workspaceId
    ? Workspace.getLocalWorkspacePath(input.workspaceId)
    : undefined
  if (input.workspaceId && !workspacePath) {
    throw new AppError({
      code: 'workspace_not_found',
      status: 404,
      message: `Workspace was not found: ${input.workspaceId}`,
    })
  }

  return await runtime.listModels({
    ...(workspacePath ? { workspacePath } : {}),
  })
}
