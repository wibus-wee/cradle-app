import { Button, Host } from '@expo/ui'
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { useTheme } from '@/theme/use-theme'

interface NativeActionProps {
  label: string
  onPress: () => void
  disabled?: boolean
  loading?: boolean
  role?: 'default' | 'destructive'
  style?: StyleProp<ViewStyle>
  testID?: string
  variant?: 'filled' | 'outlined' | 'text'
}

export function NativeAction({
  label,
  onPress,
  disabled = false,
  loading = false,
  role = 'default',
  style,
  testID,
  variant = 'filled',
}: NativeActionProps) {
  const theme = useTheme()
  const seedColor = role === 'destructive' ? theme.destructive : theme.primary

  return (
    <View style={[styles.frame, style]} testID={testID}>
      {loading
        ? <ActivityIndicator color={seedColor} style={styles.loading} />
        : (
            <Host
              colorScheme={theme.isDark ? 'dark' : 'light'}
              ignoreSafeArea="all"
              seedColor={seedColor}
              style={styles.host}
            >
              <Button
                disabled={disabled}
                label={label}
                onPress={onPress}
                style={styles.button}
                variant={variant}
              />
            </Host>
          )}
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    height: 44,
    width: '100%',
  },
  frame: {
    height: 44,
    width: '100%',
  },
  host: {
    height: 44,
    width: '100%',
  },
  loading: {
    height: 44,
  },
})
