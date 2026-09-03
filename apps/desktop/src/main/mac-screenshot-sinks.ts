/* Runs optional post-capture actions for Mac Bridge screenshots. */
import { clipboard, ClipboardItem, nativeImage, shell } from 'electron'

import type { MacCaptureFrontmostWindowResult } from './mac-bridge-protocol'

export type MacScreenshotSinkId = 'file' | 'clipboard' | 'cleanshot'

export interface MacScreenshotSinkInput {
  sink: MacScreenshotSinkId
  capture: MacCaptureFrontmostWindowResult
}

export interface MacScreenshotSinkResult {
  sink: MacScreenshotSinkId
  ok: boolean
  message: string | null
}

function cleanShotAnnotateUrl(filePath: string): string {
  const url = new URL('cleanshot://open-annotate')
  url.searchParams.set('filepath', filePath)
  return url.toString()
}

async function runClipboardSink(capture: MacCaptureFrontmostWindowResult): Promise<MacScreenshotSinkResult> {
  const image = nativeImage.createFromPath(capture.filePath)
  if (image.isEmpty()) {
    return {
      sink: 'clipboard',
      ok: false,
      message: 'Captured image could not be loaded into the clipboard.',
    }
  }
  await clipboard.write([
    new ClipboardItem({
      'image/png': new Blob([Uint8Array.from(image.toPNG())], { type: 'image/png' }),
    }),
  ])
  return {
    sink: 'clipboard',
    ok: true,
    message: null,
  }
}

async function runCleanShotSink(capture: MacCaptureFrontmostWindowResult): Promise<MacScreenshotSinkResult> {
  try {
    await shell.openExternal(cleanShotAnnotateUrl(capture.filePath))
    return {
      sink: 'cleanshot',
      ok: true,
      message: null,
    }
  }
  catch (error) {
    return {
      sink: 'cleanshot',
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function runMacScreenshotSink(input: MacScreenshotSinkInput): Promise<MacScreenshotSinkResult> {
  if (input.sink === 'file') {
    return {
      sink: 'file',
      ok: true,
      message: null,
    }
  }
  if (input.sink === 'clipboard') {
    return runClipboardSink(input.capture)
  }
  return runCleanShotSink(input.capture)
}

export const macScreenshotSinkInternals = {
  cleanShotAnnotateUrl,
}
