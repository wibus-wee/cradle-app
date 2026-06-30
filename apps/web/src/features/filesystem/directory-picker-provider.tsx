import { createContext, use, useRef, useState } from 'react'
import { z } from 'zod'

import { DirectoryBrowserDialog } from '~/features/filesystem/directory-browser-dialog'
import { isElectron, nativeIpc } from '~/lib/electron'

const DirectoryPickerOptionsSchema = z.object({
  title: z.string().default('Select Directory'),
  description: z.string().optional(),
}).default({ title: 'Select Directory' })

type DirectoryPickerOptions = z.input<typeof DirectoryPickerOptionsSchema>
type ParsedDirectoryPickerOptions = z.infer<typeof DirectoryPickerOptionsSchema>

interface DirectoryPickerContextValue {
  selectDirectory: (options?: DirectoryPickerOptions) => Promise<string | null>
}

const DirectoryPickerContext = createContext<DirectoryPickerContextValue | null>(null)

export function useDirectoryPicker() {
  const ctx = use(DirectoryPickerContext)
  if (!ctx) {
    throw new Error('useDirectoryPicker must be used within DirectoryPickerProvider')
  }
  return ctx
}

export function DirectoryPickerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [dialogProps, setDialogProps] = useState<ParsedDirectoryPickerOptions>(() => DirectoryPickerOptionsSchema.parse(undefined))
  const resolverRef = useRef<((value: string | null) => void) | null>(null)

  const selectDirectory = async (rawOptions?: DirectoryPickerOptions) => {
    const options = DirectoryPickerOptionsSchema.parse(rawOptions)
    // In Electron, use the native OS dialog
    if (isElectron && nativeIpc) {
      const result = await nativeIpc.native.showOpenDialog({
        title: options.title,
        properties: ['openDirectory'],
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }

    // In browser, fall back to the custom dialog
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve
      setDialogProps(options)
      setOpen(true)
    })
  }

  const handleSelect = (path: string) => {
    resolverRef.current?.(path)
    resolverRef.current = null
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      resolverRef.current?.(null)
      resolverRef.current = null
    }
  }

  return (
    <DirectoryPickerContext value={{ selectDirectory }}>
      {children}
      <DirectoryBrowserDialog
        open={open}
        onOpenChange={handleOpenChange}
        onSelect={handleSelect}
        {...dialogProps}
      />
    </DirectoryPickerContext>
  )
}
