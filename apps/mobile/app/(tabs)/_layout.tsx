import { Tabs } from 'expo-router'
import { FolderKanban, GitPullRequest, Settings, SquareTerminal } from 'lucide-react-native'

import { useTheme } from '@/theme/use-theme'

export default function TabsLayout() {
  const theme = useTheme()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.foreground,
        tabBarInactiveTintColor: theme.mutedForeground,
        tabBarLabelStyle: {
          fontFamily: 'Geist_500Medium',
          fontSize: 11,
        },
        tabBarStyle: {
          backgroundColor: theme.card,
          borderTopColor: theme.border,
          height: 82,
          paddingBottom: 20,
          paddingTop: 8,
        },
      }}
    >
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projects',
          tabBarIcon: ({ color, size }) => <FolderKanban color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="work"
        options={{
          title: 'Work',
          tabBarIcon: ({ color, size }) => <SquareTerminal color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="pull-requests"
        options={{
          title: 'Pull requests',
          tabBarIcon: ({ color, size }) => <GitPullRequest color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
    </Tabs>
  )
}
