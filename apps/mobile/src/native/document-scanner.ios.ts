import { requireNativeModule } from 'expo-modules-core'

interface CradleDocumentScannerModule {
  scan: () => Promise<string[]>
}

const documentScanner = requireNativeModule<CradleDocumentScannerModule>('CradleDocumentScanner')

export async function scanDocument(): Promise<string[]> {
  return documentScanner.scan()
}
