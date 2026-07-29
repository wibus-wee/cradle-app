import { NativeTabs } from 'expo-router/unstable-native-tabs'

export default function NativeTabsLayout() {
  return (
    <NativeTabs minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="projects">
        <NativeTabs.Trigger.Icon
          md="folder"
          sf={{ default: 'folder', selected: 'folder.fill' }}
        />
        <NativeTabs.Trigger.Label>Projects</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="work">
        <NativeTabs.Trigger.Icon
          md="terminal"
          sf={{ default: 'terminal', selected: 'terminal.fill' }}
        />
        <NativeTabs.Trigger.Label>Work</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="pull-requests">
        <NativeTabs.Trigger.Icon md="call_merge" sf="arrow.triangle.pull" />
        <NativeTabs.Trigger.Label>Pull requests</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          md="settings"
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
