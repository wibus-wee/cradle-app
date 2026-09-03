import { requireNativeModule } from 'expo-modules-core'

interface CradleQuickLookModule {
  preview: (fileUrl: string) => Promise<void>
}

const quickLook = requireNativeModule<CradleQuickLookModule>('CradleQuickLook')

export async function openQuickLook(fileUrl: string): Promise<void> {
  await quickLook.preview(fileUrl)
}
