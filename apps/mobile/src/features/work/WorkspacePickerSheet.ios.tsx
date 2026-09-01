import { BottomSheet } from '@expo/ui/community/bottom-sheet'
import { StyleSheet, View } from 'react-native'

import { useTheme } from '@/theme/use-theme'

import type { WorkspacePickerSheetProps } from './workspace-picker-sheet-contract'
import { WorkspacePickerContent } from './WorkspacePickerContent'

export type { WorkspacePickerSheetProps } from './workspace-picker-sheet-contract'

const snapPoints = ['78%']

export function WorkspacePickerSheet({
  onClose,
  onDismissed,
  onSelect,
  selectedWorkspaceId,
  visible,
  workspaces,
}: WorkspacePickerSheetProps) {
  const theme = useTheme()

  return (
    <BottomSheet
      backgroundStyle={{ backgroundColor: theme.surface }}
      enableDynamicSizing={false}
      enablePanDownToClose
      index={visible ? 0 : -1}
      onClose={onClose}
      onDismiss={onDismissed}
      snapPoints={snapPoints}
    >
      <View style={styles.content}>
        <WorkspacePickerContent
          fill
          onClose={onClose}
          onDismissed={onDismissed}
          onSelect={onSelect}
          selectedWorkspaceId={selectedWorkspaceId}
          visible={visible}
          workspaces={workspaces}
        />
      </View>
    </BottomSheet>
  )
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
  },
})
