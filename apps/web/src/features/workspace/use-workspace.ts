import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

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
      const dirPath = await selectDirectory({ title: '添加项目', description: '选择一个项目目录导入到 Cradle' })
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
      await addFromDirectory.mutateAsync({ body: { path: dirPath } })
    }
    finally {
      setAdding(false)
    }
  }, [addFromDirectory, inspectDirectory, selectDirectory])

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
      setRecognition(null)
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
    try {
      const name = path.split('/').filter(Boolean).pop() ?? path
      await createWorkspace.mutateAsync({ body: { name, locator: { hostId: 'local', path } } })
      setRecognition(null)
    }
    finally {
      setAdding(false)
    }
  }, [createWorkspace, recognition])

  const createFromLocator = useCallback(async (input: CreateWorkspaceInput) => {
    setAdding(true)
    try {
      await createWorkspace.mutateAsync({ body: input })
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
