import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { NativeTabsProps } from 'expo-router/unstable-native-tabs'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import type { PropsWithChildren } from 'react'
import { createElement, useContext } from 'react'
import { Platform } from 'react-native'

import type { GetSessionsResponse } from '@/api-gen'
import { useConnection } from '@/features/connection/connection-context'
import { cradleRequest } from '@/lib/api'
import { AppActiveContext } from '@/lib/app-lifecycle-context'
import { useSessionSummaryEvents } from '@/lib/use-session-summary-events'
import { useTheme } from '@/theme/use-theme'

// Expo Router 57 loses the inherited children prop under TypeScript 6. Remove this
// adapter when NativeTabsProps declares children directly.
function NativeTabNavigator({ children, ...props }: PropsWithChildren<NativeTabsProps>) {
  return createElement(NativeTabs, props, children)
}

export default function NativeTabsLayout() {
  const { connection } = useConnection()
  const isAppActive = useContext(AppActiveContext)
  const queryClient = useQueryClient()
  const theme = useTheme()
  const sessionsQuery = useQuery({
    enabled: Boolean(connection) && isAppActive,
    queryKey: ['mobile-tab-sessions', connection?.resourceId],
    queryFn: ({ signal }) =>
      cradleRequest<GetSessionsResponse>(
        connection!,
        '/sessions/?archived=false&limit=200',
        { signal },
      ),
    refetchOnMount: 'always',
  })
  useSessionSummaryEvents(connection, isAppActive, () => {
    void sessionsQuery.refetch()
    void queryClient.invalidateQueries({ queryKey: ['projects', connection?.resourceId] })
    void queryClient.invalidateQueries({ queryKey: ['workspace', connection?.resourceId] })
    void queryClient.invalidateQueries({ queryKey: ['works', connection?.resourceId] })
  })
  const unreadCount
    = sessionsQuery.data?.items.filter(session => session.unread && session.workspaceId !== null).length
      ?? 0
  const tabBarAppearance = Platform.OS === 'ios'
    ? {
        minimizeBehavior: 'onScrollDown' as const,
        sidebarAdaptable: true,
      }
    : {
        backgroundColor: theme.chrome,
        iconColor: { default: theme.mutedForeground, selected: theme.info },
        indicatorColor: theme.muted,
        labelStyle: {
          default: { color: theme.mutedForeground },
          selected: { color: theme.info },
        },
        rippleColor: theme.info,
        tintColor: theme.info,
      }

  return (
    <NativeTabNavigator
      {...tabBarAppearance}
    >
      <NativeTabs.Trigger name="projects" testID="tab-projects">
        <NativeTabs.Trigger.Icon
          md={{ default: 'folder', selected: 'folder_open' }}
          sf={{ default: 'folder', selected: 'folder.fill' }}
        />
        <NativeTabs.Trigger.Label>Workspaces</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Badge hidden={unreadCount === 0}>
          {unreadCount.toString()}
        </NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="work">
        <NativeTabs.Trigger.Icon
          md={{ default: 'terminal', selected: 'terminal' }}
          sf={{ default: 'terminal', selected: 'terminal.fill' }}
        />
        <NativeTabs.Trigger.Label>Work</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="pull-requests">
        <NativeTabs.Trigger.Icon
          md={{ default: 'call_merge', selected: 'call_merge' }}
          sf="arrow.triangle.pull"
        />
        <NativeTabs.Trigger.Label>Pulls</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings" testID="tab-settings">
        <NativeTabs.Trigger.Icon
          md={{ default: 'settings', selected: 'settings' }}
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabNavigator>
  )
}
