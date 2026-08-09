import type { GetWorkspacesResponse } from '~/api-gen/types.gen'
import type { UiActivityResolutionInputs } from '~/features/activity/resolution-inputs'
import { getMonacoLanguage } from '~/features/workspace/workspace-file-language'

import type { CodeActivityTarget } from './code-activity-bus'

type Workspace = GetWorkspacesResponse[number]

export function resolveCodeActivityTarget(
  inputs: UiActivityResolutionInputs,
  workspaces: readonly Workspace[],
  activeChatWorkspaceId: string | null,
): CodeActivityTarget | null {
  if (
    !inputs.visible
    || inputs.activeSurface?.route.to !== '/chat/$sessionId'
    || inputs.activeBrowserTab?.kind !== 'workspace-file'
    || inputs.activeBrowserTab.workspaceId !== activeChatWorkspaceId
  ) {
    return null
  }

  const tab = inputs.activeBrowserTab
  if (
    inputs.resolved?.entityType !== 'file'
    || inputs.resolved.entity !== tab.path
  ) {
    return null
  }

  const workspace = workspaces.find(candidate => candidate.id === tab.workspaceId)
  if (!workspace) {
    return null
  }

  const language = getMonacoLanguage(tab.path)
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
    },
    file: {
      relativePath: tab.path,
      ...(language === 'plaintext' ? {} : { language }),
    },
  }
}
