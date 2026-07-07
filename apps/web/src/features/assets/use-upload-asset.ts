import { useCallback, useState } from 'react'

import type { CradleAsset } from './assets-api'
import { uploadAsset } from './assets-api'

interface UseUploadAssetOptions {
  workspaceId?: string | null
}

export function useUploadAsset({ workspaceId }: UseUploadAssetOptions = {}) {
  const [pendingCount, setPendingCount] = useState(0)

  const upload = useCallback(async (file: File): Promise<CradleAsset> => {
    setPendingCount(count => count + 1)
    try {
      return await uploadAsset({ file, workspaceId })
    }
    finally {
      setPendingCount(count => Math.max(0, count - 1))
    }
  }, [workspaceId])

  return {
    upload,
    isUploading: pendingCount > 0,
  }
}
