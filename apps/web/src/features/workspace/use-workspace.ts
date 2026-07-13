import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deleteWorkspacesByWorkspaceIdMutation,
  getWorkspacesOptions,
  getWorkspacesQueryKey,
  patchWorkspacesByWorkspaceIdMutation,
  postWorkspacesFromDirectoryMutation,
  postWorkspacesInspectDirectoryMutation,
  postWorkspacesMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { PostWorkspacesData, PostWorkspacesInspectDirectoryResponse } from '~/api-gen/types.gen'
import { useDirectoryPicker } from '~/features/filesystem/directory-picker-provider'
import { trackProductTaskFinished, trackProductTaskStarted } from '~/features/product-analytics/client'
import { useAppPreferencesQuery, useUpdateAppPreferencesMutation } from '~/features/settings/use-app-preferences'

export const WORKSPACES_QUERY_KEY = getWorkspacesQueryKey()

const DEFAULT_FEATURE_FLAGS = {
  multiWorkspacePoc: false,
  localAuthForDangerousActions: false,
  continueBlockedCodexGoals: false,
  blockCodexAppServerLogInserts: false,
  nativeProviderSkillProjection: false,
}

export type WorkspaceRecognition = {
  path: string
  inspection: PostWorkspacesInspectDirectoryResponse
}
export type CreateWorkspaceInput = PostWorkspacesData['body']

export function useWorkspaces() {
  const { data: workspaces = [], isPending: loading, isSuccess: ready } = useQuery({
    ...getWorkspacesOptions(),
  })

  return { workspaces, loading, ready }
}

export function useAddWorkspace() {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [recognition, setRecognition] = useState<WorkspaceRecognition | null>(null)
  const { selectDirectory } = useDirectoryPicker()
  const invalidateWorkspaces = () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY })
  const inspectDirectory = useMutation({
    ...postWorkspacesInspectDirectoryMutation(),
  })
  const addFromDirectory = useMutation({
    ...postWorkspacesFromDirectoryMutation(),
    onSuccess: invalidateWorkspaces,
  })
  const createWorkspace = useMutation({
    ...postWorkspacesMutation(),
    onSuccess: invalidateWorkspaces,
  })
  const { mutateAsync: savePreferences } = useUpdateAppPreferencesMutation()
  const { data: appPrefs } = useAppPreferencesQuery()

  const addFromPicker = useCallback(async () => {
    setAdding(true)
    try {
      const dirPath = await selectDirectory({ title: t('workspace.dialog.addProject'), description: t('workspace.dialog.addProjectDescription') })
      if (!dirPath) {
        return
      }
      // Recognize before acting: if the directory holds a cradle-workspace.json,
      // surface that to the user and let them choose how to open it instead of
      // silently routing (or blocking) the import.
      const inspection = await inspectDirectory.mutateAsync({ body: { path: dirPath } })
      if (inspection.cradleWorkspaceDetected) {
        setRecognition({ path: dirPath, inspection })
        return
      }
      const analyticsTask = trackProductTaskStarted({
        feature_domain: 'workspace',
        task_kind: 'workspace_add',
        task_variant: 'local',
      })
      try {
        await addFromDirectory.mutateAsync({ body: { path: dirPath } })
        trackProductTaskFinished(analyticsTask, 'success')
      }
      catch (error) {
        trackProductTaskFinished(analyticsTask, 'failed')
        throw error
      }
    }
    finally {
      setAdding(false)
    }
  }, [addFromDirectory, inspectDirectory, selectDirectory, t])

  const dismissRecognition = useCallback(() => {
    setRecognition(null)
  }, [])

  // Open the recognized directory as a Cradle (multi-folder) workspace. Enables
  // the experimental feature flag on explicit user consent when it is off, then
  // imports the directory — addFromDirectory routes to the multi-folder import
  // once the flag is on.
  const openAsCradleWorkspace = useCallback(async () => {
    if (!recognition) {
      return
    }
    const { path, inspection } = recognition
    setAdding(true)
    const analyticsTask = trackProductTaskStarted({
      feature_domain: 'workspace',
      task_kind: 'workspace_add',
      task_variant: 'local',
    })
    try {
      if (!inspection.featureFlagEnabled) {
        await savePreferences({
          featureFlags: {
            ...DEFAULT_FEATURE_FLAGS,
            ...appPrefs?.featureFlags,
            multiWorkspacePoc: true,
          },
        })
      }
      await addFromDirectory.mutateAsync({ body: { path } })
      trackProductTaskFinished(analyticsTask, 'success')
      setRecognition(null)
    }
    catch (error) {
      trackProductTaskFinished(analyticsTask, 'failed')
      throw error
    }
    finally {
      setAdding(false)
    }
  }, [addFromDirectory, appPrefs, recognition, savePreferences])

  // Always-import-as-single-folder: use the plain create endpoint so the result
  // is deterministic regardless of the experimental flag (from-directory would
  // route to multi-folder when the flag is on).
  const addAsSingleFolder = useCallback(async () => {
    if (!recognition) {
      return
    }
    const { path } = recognition
    setAdding(true)
    const analyticsTask = trackProductTaskStarted({
      feature_domain: 'workspace',
      task_kind: 'workspace_add',
      task_variant: 'local',
    })
    try {
      const name = path.split('/').filter(Boolean).pop() ?? path
      await createWorkspace.mutateAsync({ body: { name, locator: { hostId: 'local', path } } })
      trackProductTaskFinished(analyticsTask, 'success')
      setRecognition(null)
    }
    catch (error) {
      trackProductTaskFinished(analyticsTask, 'failed')
      throw error
    }
    finally {
      setAdding(false)
    }
  }, [createWorkspace, recognition])

  const createFromLocator = useCallback(async (input: CreateWorkspaceInput) => {
    setAdding(true)
    const taskVariant = input.locator.hostId === 'local' ? 'local' : 'remote'
    const analyticsTask = trackProductTaskStarted({
      feature_domain: 'workspace',
      task_kind: 'workspace_add',
      task_variant: taskVariant,
    })
    try {
      await createWorkspace.mutateAsync({ body: input })
      trackProductTaskFinished(analyticsTask, 'success')
    }
    catch (error) {
      trackProductTaskFinished(analyticsTask, 'failed')
      throw error
    }
    finally {
      setAdding(false)
    }
  }, [createWorkspace])

  return {
    addFromPicker,
    createFromLocator,
    adding,
    recognition,
    dismissRecognition,
    openAsCradleWorkspace,
    addAsSingleFolder,
  }
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient()

  const { mutate: remove } = useMutation({
    ...deleteWorkspacesByWorkspaceIdMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  })

  return { remove }
}

export function useToggleWorkspacePin() {
  const queryClient = useQueryClient()

  const { mutate: togglePin } = useMutation({
    ...patchWorkspacesByWorkspaceIdMutation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
  })

  return { togglePin }
}
