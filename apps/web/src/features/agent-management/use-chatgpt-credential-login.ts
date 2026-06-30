import { useMutation, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

import {
  getProviderTargetsCredentialsChatgptLoginByLoginId,
  postProviderTargetsCredentialsChatgptLogin,
  postProviderTargetsCredentialsChatgptLoginByLoginIdCancel,
} from '~/api-gen/sdk.gen'
import { nativeIpc } from '~/lib/electron'

const ChatgptCredentialLoginStartSchema = z.object({
  loginId: z.string().min(1),
  verificationUrl: z.string().min(1),
  userCode: z.string().min(1),
  expiresAt: z.number(),
})

const ChatgptCredentialLoginStatusSchema = z.object({
  loginId: z.string().min(1),
  state: z.enum(['pending', 'completed', 'failed', 'cancelled']),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  credentialRef: z.string().nullable(),
  email: z.string().nullable(),
  planType: z.string().nullable(),
  error: z.string().nullable(),
})

export type ChatgptCredentialLoginStart = z.infer<typeof ChatgptCredentialLoginStartSchema>
export type ChatgptCredentialLoginStatus = z.infer<typeof ChatgptCredentialLoginStatusSchema>

export function reserveChatgptCredentialLoginWindow(): Window | null {
  if (nativeIpc?.native?.openExternal) {
    return null
  }

  const reservedWindow = window.open('', '_blank')
  if (!reservedWindow) {
    return null
  }

  reservedWindow.opener = null
  reservedWindow.document.title = 'ChatGPT Login'
  return reservedWindow
}

function navigateReservedLoginWindow(reservedWindow: Window | null, verificationUrl: string): boolean {
  if (!reservedWindow || reservedWindow.closed) {
    return false
  }

  try {
    reservedWindow.location.href = verificationUrl
    reservedWindow.focus()
    return true
  }
  catch {
    return false
  }
}

function openLoginWindowFallback(verificationUrl: string): boolean {
  return window.open(verificationUrl, '_blank', 'noopener,noreferrer') !== null
}

export async function openChatgptCredentialLoginUrl(
  verificationUrl: string,
  reservedWindow: Window | null,
): Promise<void> {
  if (nativeIpc?.native?.openExternal) {
    try {
      await nativeIpc.native.openExternal(verificationUrl)
      return
    }
    catch (error) {
      console.error('[ChatGPTCredentialLogin] native openExternal failed', error)
    }
  }

  if (navigateReservedLoginWindow(reservedWindow, verificationUrl)) {
    return
  }

  if (openLoginWindowFallback(verificationUrl)) {
    return
  }

  throw new Error('Unable to open ChatGPT login in a browser')
}

export function useChatgptCredentialLoginStatus(loginId: string | null) {
  return useQuery({
    queryKey: ['provider-targets', 'credentials', 'chatgpt', 'login', loginId],
    queryFn: async () => {
      const { data } = await getProviderTargetsCredentialsChatgptLoginByLoginId({
        path: { loginId: loginId ?? '' },
        throwOnError: true,
      })
      return ChatgptCredentialLoginStatusSchema.parse(data)
    },
    enabled: !!loginId,
    refetchInterval: query => query.state.data?.state === 'pending' ? 1500 : false,
  })
}

export function useChatgptCredentialLoginActions() {
  const startLogin = useMutation({
    mutationFn: async (label: string) => {
      const { data } = await postProviderTargetsCredentialsChatgptLogin({
        body: { label },
        throwOnError: true,
      })
      return ChatgptCredentialLoginStartSchema.parse(data)
    },
  })

  const cancelLogin = useMutation({
    mutationFn: (loginId: string) => postProviderTargetsCredentialsChatgptLoginByLoginIdCancel({
      path: { loginId },
      throwOnError: true,
    }),
  })

  return { startLogin, cancelLogin }
}
