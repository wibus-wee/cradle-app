import type { ContextEnvelope } from '~/features/context/context-items'

import { assembleContextForPrompt } from './context-assembler'
import type { SystemAgentContext } from './context-schema'

const RE_CONTEXT_TAG = /<\/?cradle_context>/gi
const RE_WHITESPACE = /\s+/g

function contextValue(value: string): string {
  return value
    .replace(RE_CONTEXT_TAG, tag => tag.replaceAll('<', '[').replaceAll('>', ']'))
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(RE_WHITESPACE, ' ')
    .trim()
}

function getOtherSurfaceLabels(ctx: SystemAgentContext): string[] {
  let activeSkipped = false
  return ctx.openSurfaces.flatMap((surface) => {
    if (
      ctx.activeSurface
      && !activeSkipped
      && surface.type === ctx.activeSurface.type
      && surface.label === ctx.activeSurface.label
    ) {
      activeSkipped = true
      return []
    }
    return [contextValue(surface.label || surface.type)]
  })
}

/**
 * Formats a SystemAgentContext snapshot into a concise text block
 * that gets prepended to the user message for agent awareness.
 *
 * Design constraints:
 * - Must NOT go in system prompt (breaks KV cache)
 * - Prepended to user message via ingress:before hook
 * - Keep it short — every token counts
 */
export function formatContextForAgent(ctx: SystemAgentContext): string {
  const lines: string[] = []

  // Active surface
  if (ctx.activeSurface) {
    const surfaceDesc = contextValue(ctx.activeSurface.label || ctx.activeSurface.type)
    lines.push(`viewing: ${surfaceDesc} (${contextValue(ctx.activeSurface.type)})`)
    if (Object.keys(ctx.activeSurface.params).length > 0) {
      const params = Object.entries(ctx.activeSurface.params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${contextValue(k)}=${contextValue(v!)}`)
        .join(', ')
      if (params) {
        lines.push(`  params: ${params}`)
      }
    }
  }
  else {
    lines.push('viewing: nothing (no active surface)')
  }

  // Open surfaces summary
  if (ctx.openSurfaces.length > 1) {
    const others = getOtherSurfaceLabels(ctx)
    if (others.length > 0) {
      lines.push(`other surfaces: ${others.join(', ')}`)
    }
  }

  // Chat context
  if (ctx.chatContext) {
    const { sessionId, status, messageCount, recentMessages } = ctx.chatContext
    lines.push(`chat: session=${contextValue(sessionId)} status=${contextValue(status)} messages=${messageCount}`)
    if (recentMessages.length > 0) {
      const last = recentMessages.at(-1)
      if (last) {
        lines.push(`  last msg: [${contextValue(last.role)}] ${contextValue(last.contentPreview)}`)
      }
    }
  }

  // Layout awareness (only notable states)
  const layout: string[] = []
  if (ctx.layout.settingsOpen) {
    layout.push(`in settings (${contextValue(ctx.layout.settingsSection)})`)
  }
  if (ctx.layout.asideOpen) {
    layout.push(`aside open (${contextValue(ctx.layout.asideActiveTab)})`)
  }
  if (ctx.layout.bottomPanelOpen) {
    layout.push('bottom panel open')
  }
  if (ctx.layout.sidebarCollapsed) {
    layout.push('sidebar collapsed')
  }
  if (layout.length > 0) {
    lines.push(`layout: ${layout.join(', ')}`)
  }

  // Unread
  if (ctx.unreadSessionIds.length > 0) {
    lines.push(`unread: ${ctx.unreadSessionIds.length} session(s)`)
  }

  // Profile
  if (ctx.activeProfileId) {
    lines.push(`profile: ${contextValue(ctx.activeProfileId)}`)
  }

  return `<cradle_context>\n${lines.join('\n')}\n</cradle_context>`
}

export function formatContextEnvelopeForAgent(envelope: ContextEnvelope): string {
  return assembleContextForPrompt(envelope).promptBlock
}
