import type { MenuAction } from '@expo/ui/community/menu'
import { MenuView } from '@expo/ui/community/menu'
import { Menu } from 'lucide-react-native'
import { StyleSheet, View } from 'react-native'

import { useTheme } from '@/theme/use-theme'

export type AppSection = 'projects' | 'work' | 'pull-requests' | 'settings'

interface AppMenuButtonProps {
  current: AppSection
  onSelect: (section: AppSection) => void
}

const sections: Array<{
  image: NonNullable<MenuAction['image']>
  label: string
  value: AppSection
}> = [
  { image: 'folder', label: 'Workspaces', value: 'projects' },
  { image: 'terminal', label: 'Work', value: 'work' },
  { image: 'arrow.triangle.pull', label: 'Pull requests', value: 'pull-requests' },
  { image: 'gearshape', label: 'Settings', value: 'settings' },
]

export function AppMenuButton({ current, onSelect }: AppMenuButtonProps) {
  const theme = useTheme()
  const actions: MenuAction[] = sections.map(section => ({
    id: section.value,
    image: section.image,
    state: section.value === current ? 'on' : 'off',
    title: section.label,
  }))

  return (
    <MenuView
      actions={actions}
      onPressAction={({ nativeEvent }) => {
        const section = sections.find(item => item.value === nativeEvent.event)
        if (section && section.value !== current) {
          onSelect(section.value)
        }
      }}
      style={styles.menu}
    >
      <View
        accessibilityLabel="Open navigation"
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: theme.surface, borderColor: theme.input }]}
      >
        <Menu color={theme.foreground} size={20} />
      </View>
    </MenuView>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  menu: {
    height: 44,
    width: 44,
  },
})
