import { contextBridge, ipcRenderer } from 'electron'

import { installBrowserAnnotationRuntime } from './browser-annotation-runtime'
import type { BrowserPanelAttachmentInput, BrowserPanelSendPromptInput } from './browser-panel-contract'
import {
  BROWSER_SEND_PROMPT_CHANNEL,
} from './browser-panel-contract'
import { normalizeSendPromptPayload } from './browser-panel-prompt'

contextBridge.exposeInMainWorld('codex', {
  async sendPrompt(
    input: BrowserPanelSendPromptInput,
    attachments?: BrowserPanelAttachmentInput[],
  ): Promise<void> {
    await ipcRenderer.invoke(
      BROWSER_SEND_PROMPT_CHANNEL,
      await normalizeSendPromptPayload(input, attachments),
    )
  },
})

installBrowserAnnotationRuntime()
