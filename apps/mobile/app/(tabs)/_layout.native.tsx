import { Stack } from 'expo-router'

export default function NativeTabsLayout() {
  return <Stack screenOptions={{ freezeOnBlur: true, headerShown: false }} />
}
