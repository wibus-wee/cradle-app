/**
 * Browser Use Protocol — shared types and framing for Unix Domain Socket communication
 * between the MCP server (plugin) and the Browser Backend (Electron main).
 *
 * Wire format: 4-byte LE length prefix + UTF-8 JSON payload
 */

import { z } from 'zod'

// ─── Command Types ──────────────────────────────────────────────────────────

export interface NavigateCommand {
  type: 'navigate'
  id: string
  url: string
  tabId?: string
}

export interface ScreenshotCommand {
  type: 'screenshot'
  id: string
  tabId?: string
  fullPage?: boolean
}

export interface ClickCommand {
  type: 'click'
  id: string
  tabId?: string
  selector: string
}

export interface TypeCommand {
  type: 'type'
  id: string
  tabId?: string
  selector: string
  text: string
}

export interface GetTextCommand {
  type: 'get_text'
  id: string
  tabId?: string
  selector?: string
}

export interface TabsListCommand {
  type: 'tabs_list'
  id: string
}

export interface TabsNewCommand {
  type: 'tabs_new'
  id: string
  url?: string
}

export interface TabsCloseCommand {
  type: 'tabs_close'
  id: string
  tabId: string
}

export interface TabsGoOffScreenCommand {
  type: 'tabs_go_off_screen'
  id: string
  tabId?: string
}

export interface TabsBringToFrontCommand {
  type: 'tabs_bring_to_front'
  id: string
  tabId?: string
}

export interface EvalCommand {
  type: 'eval'
  id: string
  tabId?: string
  expression: string
}

export interface ScrollCommand {
  type: 'scroll'
  id: string
  tabId?: string
  selector?: string
  direction: 'up' | 'down' | 'left' | 'right'
  amount?: number
}

export interface HoverCommand {
  type: 'hover'
  id: string
  tabId?: string
  selector: string
}

export interface DomSnapshotCommand {
  type: 'dom_snapshot'
  id: string
  tabId?: string
}

export interface WaitForSelectorCommand {
  type: 'wait_for_selector'
  id: string
  tabId?: string
  selector: string
  timeout?: number
}

export interface KeyboardCommand {
  type: 'keyboard'
  id: string
  tabId?: string
  key: string
  modifiers?: string[]
}

export type BrowserCommand
  = | NavigateCommand
    | ScreenshotCommand
    | ClickCommand
    | TypeCommand
    | GetTextCommand
    | TabsListCommand
    | TabsNewCommand
    | TabsCloseCommand
    | TabsGoOffScreenCommand
    | TabsBringToFrontCommand
    | EvalCommand
    | ScrollCommand
    | HoverCommand
    | DomSnapshotCommand
    | WaitForSelectorCommand
    | KeyboardCommand

// ─── Response Types ─────────────────────────────────────────────────────────

export interface SuccessResponse<T = unknown> {
  id: string
  ok: true
  data: T
}

export interface ErrorResponse {
  id: string
  ok: false
  error: string
}

export type BrowserResponse<T = unknown> = SuccessResponse<T> | ErrorResponse

// ─── Typed Response Data ────────────────────────────────────────────────────

export interface TabInfo {
  id: string
  url: string
  title: string
}

export type NavigateResult = { url: string, title: string }
export type ScreenshotResult = { base64: string, mimeType: 'image/png' }
export type ClickResult = { success: true }
export type TypeResult = { success: true }
export type GetTextResult = { text: string }
export type TabsListResult = { tabs: TabInfo[] }
export type TabsNewResult = { tab: TabInfo }
export type TabsCloseResult = { success: true }
export type TabsVisibilityResult = { success: true }
export type EvalResult = { result: unknown }
export type ScrollResult = { success: true }
export type HoverResult = { success: true }
export interface AXNode { role: string, name: string, value?: string, description?: string, children?: AXNode[] }
export type DomSnapshotResult = { nodes: AXNode[] }
export type WaitForSelectorResult = { found: true }
export type KeyboardResult = { success: true }

const BrowserCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), id: z.string(), url: z.string(), tabId: z.string().optional() }),
  z.object({ type: z.literal('screenshot'), id: z.string(), tabId: z.string().optional(), fullPage: z.boolean().optional() }),
  z.object({ type: z.literal('click'), id: z.string(), tabId: z.string().optional(), selector: z.string() }),
  z.object({ type: z.literal('type'), id: z.string(), tabId: z.string().optional(), selector: z.string(), text: z.string() }),
  z.object({ type: z.literal('get_text'), id: z.string(), tabId: z.string().optional(), selector: z.string().optional() }),
  z.object({ type: z.literal('tabs_list'), id: z.string() }),
  z.object({ type: z.literal('tabs_new'), id: z.string(), url: z.string().optional() }),
  z.object({ type: z.literal('tabs_close'), id: z.string(), tabId: z.string() }),
  z.object({ type: z.literal('tabs_go_off_screen'), id: z.string(), tabId: z.string().optional() }),
  z.object({ type: z.literal('tabs_bring_to_front'), id: z.string(), tabId: z.string().optional() }),
  z.object({ type: z.literal('eval'), id: z.string(), tabId: z.string().optional(), expression: z.string() }),
  z.object({
    type: z.literal('scroll'),
    id: z.string(),
    tabId: z.string().optional(),
    selector: z.string().optional(),
    direction: z.enum(['up', 'down', 'left', 'right']),
    amount: z.number().optional(),
  }),
  z.object({ type: z.literal('hover'), id: z.string(), tabId: z.string().optional(), selector: z.string() }),
  z.object({ type: z.literal('dom_snapshot'), id: z.string(), tabId: z.string().optional() }),
  z.object({ type: z.literal('wait_for_selector'), id: z.string(), tabId: z.string().optional(), selector: z.string(), timeout: z.number().optional() }),
  z.object({ type: z.literal('keyboard'), id: z.string(), tabId: z.string().optional(), key: z.string(), modifiers: z.array(z.string()).optional() }),
])

const BrowserResponseSchema = z.union([
  z.object({
    id: z.string(),
    ok: z.literal(true),
    data: z.unknown(),
  }),
  z.object({
    id: z.string(),
    ok: z.literal(false),
    error: z.string(),
  }),
])

const BrowserFrameJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.union([BrowserCommandSchema, BrowserResponseSchema]))

// ─── Framing ────────────────────────────────────────────────────────────────

/** Encode a message into a framed buffer (4B LE length + UTF-8 JSON) */
export function encodeFrame(message: BrowserCommand | BrowserResponse): Buffer {
  const json = JSON.stringify(message)
  const payload = Buffer.from(json, 'utf-8')
  const frame = Buffer.alloc(4 + payload.length)
  frame.writeUInt32LE(payload.length, 0)
  payload.copy(frame, 4)
  return frame
}

/**
 * Frame decoder — accumulates chunks and yields complete messages.
 * Usage: call `push(chunk)` for each incoming data event.
 */
export class FrameDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): Array<BrowserCommand | BrowserResponse> {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: Array<BrowserCommand | BrowserResponse> = []

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (this.buffer.length < 4 + length) {
        break
      }
      const json = this.buffer.subarray(4, 4 + length).toString('utf-8')
      this.buffer = this.buffer.subarray(4 + length)
      messages.push(BrowserFrameJsonSchema.parse(json))
    }

    return messages
  }
}
