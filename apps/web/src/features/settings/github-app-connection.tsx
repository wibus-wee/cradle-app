import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  deleteGithubAuthConnection,
  getGithubAuthConnection,
  getGithubAuthDeviceLoginByLoginId,
  postGithubAuthDeviceLogin,
  postGithubAuthDeviceLoginByLoginIdCancel,
} from '~/api-gen/sdk.gen'
import type { GetGithubAuthConnectionResponse, PostGithubAuthDeviceLoginResponse } from '~/api-gen/types.gen'
import { toastManager } from '~/components/ui/toast'
import { nativeIpc } from '~/lib/electron'

import { GithubAppConnectionView } from './github-app-connection-view'

const connectionQueryKey = ['github-auth', 'connection'] as const

function openExternal(url: string): void {
  if (nativeIpc?.native?.openExternal) {
    void nativeIpc.native.openExternal(url).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer')
    })
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function GithubAppConnection() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  const [pendingLogin, setPendingLogin] = useState<PostGithubAuthDeviceLoginResponse | null>(null)
  const connectionQuery = useQuery({
    queryKey: connectionQueryKey,
    queryFn: async () => {
      const { data } = await getGithubAuthConnection({ throwOnError: true })
      return data
    },
  })
  const loginQuery = useQuery({
    queryKey: ['github-auth', 'device-login', pendingLogin?.loginId],
    enabled: pendingLogin !== null,
    queryFn: async () => {
      const { data } = await getGithubAuthDeviceLoginByLoginId({
        path: { loginId: pendingLogin?.loginId ?? '' },
        throwOnError: true,
      })
      return data
    },
    refetchInterval: query => query.state.data?.state === 'pending' ? 1500 : false,
  })
  const startMutation = useMutation({
    mutationFn: async () => {
      const { data } = await postGithubAuthDeviceLogin({ throwOnError: true })
      return data
    },
    onSuccess: (login) => {
      setPendingLogin(login)
      void queryClient.invalidateQueries({ queryKey: connectionQueryKey })
      openExternal(login.verificationUri)
    },
    onError: () => toastManager.add({ type: 'error', title: t('githubApp.toast.connectFailed') }),
  })
  const cancelMutation = useMutation({
    mutationFn: (loginId: string) => postGithubAuthDeviceLoginByLoginIdCancel({ path: { loginId }, throwOnError: true }),
    onSuccess: () => {
      setPendingLogin(null)
      void queryClient.invalidateQueries({ queryKey: connectionQueryKey })
    },
  })
  const disconnectMutation = useMutation({
    mutationFn: () => deleteGithubAuthConnection({ throwOnError: true }),
    onSuccess: () => {
      setPendingLogin(null)
      void queryClient.invalidateQueries({ queryKey: connectionQueryKey })
    },
    onError: () => toastManager.add({ type: 'error', title: t('githubApp.toast.disconnectFailed') }),
  })

  useEffect(() => {
    const loginState = loginQuery.data?.state
    if (loginState && loginState !== 'pending') {
      setPendingLogin(null)
      void queryClient.invalidateQueries({ queryKey: connectionQueryKey })
      if (loginState === 'failed') {
        toastManager.add({ type: 'error', title: t('githubApp.toast.connectFailed') })
      }
    }
  }, [loginQuery.data?.state, queryClient, t])

  const connection = connectionQuery.data as GetGithubAuthConnectionResponse | undefined
  return (
    <GithubAppConnectionView
      connection={connection ?? null}
      pendingLogin={pendingLogin}
      loading={connectionQuery.isLoading}
      connecting={startMutation.isPending}
      disconnecting={disconnectMutation.isPending}
      labels={{
        title: t('githubApp.title'),
        description: t('githubApp.description'),
        appBadge: t('githubApp.badge'),
        installTitle: t('githubApp.install.title'),
        installDescription: t('githubApp.install.description'),
        install: t('githubApp.actions.install'),
        connectTitle: t('githubApp.connect.title'),
        connectDescription: t('githubApp.connect.description'),
        connect: t('githubApp.actions.connect'),
        connecting: t('githubApp.connecting'),
        continueInBrowser: t('githubApp.actions.continueInBrowser'),
        cancel: t('githubApp.actions.cancel'),
        disconnect: t('githubApp.actions.disconnect'),
        disconnectTitle: t('githubApp.disconnect.title'),
        disconnectDescription: t('githubApp.disconnect.description'),
        confirmDisconnect: t('githubApp.actions.confirmDisconnect'),
        connected: t('githubApp.connected'),
        expires: t('githubApp.expires'),
        expired: t('githubApp.expired'),
        unavailable: t('githubApp.unavailable'),
        pendingCode: t('githubApp.pendingCode'),
      }}
      onInstall={() => {
        if (connection?.installationUrl) {
          openExternal(connection.installationUrl)
        }
      }}
      onConnect={() => startMutation.mutate()}
      onContinueInBrowser={() => {
        if (pendingLogin) {
          openExternal(pendingLogin.verificationUri)
        }
      }}
      onCancel={() => {
        if (pendingLogin) {
          cancelMutation.mutate(pendingLogin.loginId)
        }
      }}
      onDisconnect={() => disconnectMutation.mutate()}
    />
  )
}
