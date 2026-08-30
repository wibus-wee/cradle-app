import { useMutation, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Alert } from 'react-native'

import type { PostWorksData, PostWorksResponse } from '@/api-gen'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

export function useCreateWork() {
  const { connection } = useConnection()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: PostWorksData['body']) => cradleRequest<PostWorksResponse>(
      connection!,
      '/works',
      {
        method: 'POST',
        body: {
          ...input,
          objective: input.objective || input.title,
        },
      },
    ),
    onSuccess: (work) => {
      void queryClient.invalidateQueries({ queryKey: ['works', connection?.url] })
      void queryClient.invalidateQueries({ queryKey: ['workspace', connection?.url] })
      router.push(`/work/${work.work.id}`)
    },
    onError: error => Alert.alert('Could not create Work', errorMessage(error)),
  })
}
