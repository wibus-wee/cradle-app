import type { FileUIPart } from 'ai'
import { convertFileListToFileUIParts } from 'ai'
import type { ChangeEvent, ClipboardEvent, RefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ModelDescriptor } from '~/features/agent-runtime/types'
import { isLocalMode } from '~/lib/electron'

export interface ComposerAttachmentController {
  attachments: FileUIPart[]
  appendFileParts: (fileParts: FileUIPart[]) => void
  fileInputRef: RefObject<HTMLInputElement | null>
  hasAttachments: boolean
  supportsAttachments: boolean
  clearAttachments: () => void
  handleFilesSelected: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  handlePaste: (event: ClipboardEvent<HTMLElement>) => void
  pickFiles: () => void
  removeAttachment: (index: number) => void
}

interface ComposerAttachmentConfig {
  supportsAttachments?: boolean
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => resolve(event.target?.result as string)
    reader.onerror = error => reject(error)
    reader.readAsDataURL(file)
  })
}

/**
 * Converts a File to a FileUIPart.
 * In local mode (Electron + local server), uses file:// paths instead of data URLs.
 */
async function convertFileToFileUIPart(file: File): Promise<FileUIPart> {
  // In local mode, if the file has a path property (from Electron drag), use it directly
  if (isLocalMode() && 'path' in file && typeof (file as File & { path?: string }).path === 'string') {
    const filePath = (file as File & { path?: string }).path!
    return {
      type: 'file' as const,
      mediaType: file.type || 'application/octet-stream',
      filename: file.name,
      url: `file://${filePath}`,
    }
  }

  // Otherwise, read file as data URL (default behavior)
  return {
    type: 'file' as const,
    mediaType: file.type || 'application/octet-stream',
    filename: file.name,
    url: await readFileAsDataUrl(file),
  }
}

async function convertFileArrayToFileUIParts(files: File[]): Promise<FileUIPart[]> {
  return Promise.all(files.map(file => convertFileToFileUIPart(file)))
}

function readClipboardFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files)
  if (files.length > 0) {
    return files
  }

  const itemFiles: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') {
      continue
    }
    const file = item.getAsFile()
    if (file) {
      itemFiles.push(file)
    }
  }
  return itemFiles
}

export function modelSupportsAttachments(model: ModelDescriptor | null | undefined): boolean {
  const modalities = model?.capabilities.inputModalities ?? []
  return modalities.some(modality => modality !== 'text')
}

export function useComposerAttachments({
  supportsAttachments = false,
}: ComposerAttachmentConfig = {}): ComposerAttachmentController {
  const [attachments, setAttachments] = useState<FileUIPart[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const clearAttachments = useCallback(() => {
    setAttachments([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const appendFileParts = useCallback((fileParts: FileUIPart[]) => {
    setAttachments(current => [...fileParts, ...current])
  }, [])

  const appendSelectedFiles = useCallback(async (files: FileList) => {
    if (files.length === 0 || !supportsAttachments) {
      return
    }
    // In local mode, use our custom converter that preserves file paths
    if (isLocalMode()) {
      const fileParts = await convertFileArrayToFileUIParts(Array.from(files))
      appendFileParts(fileParts)
    }
    else {
      const fileParts = await convertFileListToFileUIParts(files)
      appendFileParts(fileParts)
    }
  }, [appendFileParts, supportsAttachments])

  const appendPastedFiles = useCallback(async (files: File[]) => {
    if (files.length === 0 || !supportsAttachments) {
      return
    }
    const fileParts = await convertFileArrayToFileUIParts(files)
    appendFileParts(fileParts)
  }, [appendFileParts, supportsAttachments])

  const handleFilesSelected = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files
    if (!selectedFiles || selectedFiles.length === 0) {
      return
    }
    await appendSelectedFiles(selectedFiles)
    event.target.value = ''
  }, [appendSelectedFiles])

  const handlePaste = useCallback((event: ClipboardEvent<HTMLElement>) => {
    if (!supportsAttachments) {
      return
    }

    const files = readClipboardFiles(event.clipboardData)
    if (files.length === 0) {
      return
    }

    event.preventDefault()
    void appendPastedFiles(files)
  }, [appendPastedFiles, supportsAttachments])

  const pickFiles = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setAttachments(current => current.filter((_, itemIndex) => itemIndex !== index))
  }, [])

  useEffect(() => {
    if (supportsAttachments) {
      return
    }
    clearAttachments()
  }, [clearAttachments, supportsAttachments])

  return useMemo(() => ({
    attachments,
    appendFileParts,
    fileInputRef,
    hasAttachments: attachments.length > 0,
    supportsAttachments,
    clearAttachments,
    handleFilesSelected,
    handlePaste,
    pickFiles,
    removeAttachment,
  }), [
    attachments,
    appendFileParts,
    clearAttachments,
    handleFilesSelected,
    handlePaste,
    pickFiles,
    removeAttachment,
    supportsAttachments,
  ])
}
