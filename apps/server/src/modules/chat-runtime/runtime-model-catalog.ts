import { AppError } from '../../errors/app-error'
import { resolveProviderTargetForRuntime } from '../provider-targets/service'
import * as Workspace from '../workspace/service'
import { getRuntimeRegistry } from './chat-runtime-provider-registry'
import type { RuntimeKind, RuntimeModelCatalog, RuntimeProviderTargetProfile } from './runtime-provider-types'

export async function listRuntimeModels(input: {
  runtimeKind: RuntimeKind
  workspaceId?: string
  providerTargetId?: string
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

  const profile = input.providerTargetId
    ? resolveRuntimeModelCatalogProfile(input.providerTargetId, input.runtimeKind)
    : null

  return await runtime.listModels({
    ...(workspacePath ? { workspacePath } : {}),
    profile,
  })
}

function resolveRuntimeModelCatalogProfile(
  providerTargetId: string,
  runtimeKind: RuntimeKind,
): RuntimeProviderTargetProfile {
  const target = resolveProviderTargetForRuntime(providerTargetId, runtimeKind)
  if (!target.enabled) {
    throw new AppError({
      code: 'provider_target_disabled',
      status: 409,
      message: `Provider target is disabled: ${providerTargetId}`,
    })
  }
  return {
    id: target.id,
    name: target.label,
    providerKind: target.providerKind,
    enabled: target.enabled,
    configJson: target.configJson,
    credentialRef: target.credentialRef,
    customModels: target.customModelsJson,
    iconSlug: target.iconSlug,
    providerTargetKind: target.target.kind,
    providerTargetId: target.target.id,
  }
}
