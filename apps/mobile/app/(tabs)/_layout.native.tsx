import type { NativeTabsProps } from 'expo-router/unstable-native-tabs'
import { NativeTabs } from 'expo-router/unstable-native-tabs'
import type { PropsWithChildren } from 'react'
import { createElement } from 'react'

import { useTheme } from '@/theme/use-theme'

// Expo Router 57 loses the inherited children prop under TypeScript 6. Remove this
// adapter when NativeTabsProps declares children directly.
function NativeTabNavigator({ children, ...props }: PropsWithChildren<NativeTabsProps>) {
  return createElement(NativeTabs, props, children)
}

export default function NativeTabsLayout() {
  const theme = useTheme()

  return (
    <NativeTabNavigator
      backgroundColor={theme.chrome}
      blurEffect="systemChromeMaterial"
      disableTransparentOnScrollEdge
      iconColor={{ default: theme.mutedForeground, selected: theme.info }}
      indicatorColor={theme.muted}
      labelStyle={{
        default: { color: theme.mutedForeground },
        selected: { color: theme.info },
      }}
      rippleColor={theme.info}
      tintColor={theme.info}
    >
      <NativeTabs.Trigger name="projects">
        <NativeTabs.Trigger.Icon
          md={{ default: 'folder', selected: 'folder_open' }}
          sf={{ default: 'folder', selected: 'folder.fill' }}
        />
        <NativeTabs.Trigger.Label>Workspaces</NativeTabs.Trigger.Label>
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
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          md={{ default: 'settings', selected: 'settings' }}
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabNavigator>
  )
}
