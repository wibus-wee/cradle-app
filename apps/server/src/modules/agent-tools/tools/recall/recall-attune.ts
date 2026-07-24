import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { AgentToolHttpRequestError, requestAgentToolJson } from '../../http-client'
import type { AgentToolRegistration } from '../../registry'

export const RECALL_ATTUNE_TOOL_NAME = 'recall_attune'

function currentChatSessionId(): string | null {
  return process.env.CRADLE_CHAT_SESSION_ID?.trim() || null
}

function registerRecallAttuneTool(server: McpServer): void {
  server.registerTool(
    RECALL_ATTUNE_TOOL_NAME,
    {
      title: 'Recall Attune',
      description: 'Propose one evidence-anchored Recall memory action. The action is never executed until the user approves it.',
      inputSchema: { code: z.string().min(1).describe('JavaScript CodeAct that calls exactly one remember(content, evidenceIds) or forget(id).') },
    },
    async ({ code }) => {
      const chatSessionId = currentChatSessionId()
      if (!chatSessionId) { return { content: [{ type: 'text' as const, text: 'recall_attune is unavailable because this runtime did not bind a Cradle chat session.' }], isError: true } }
      try {
        const request = await requestAgentToolJson({
          path: '/recall/attune',
body: { chatSessionId, code },
          responseSchema: z.object({ id: z.string(), status: z.literal('pending') }),
        })
        return { content: [{ type: 'text' as const, text: `Recall attunement ${request.id} is pending user approval.` }] }
      }
      catch (error) {
        const text = error instanceof AgentToolHttpRequestError ? `recall_attune failed (${error.code ?? 'request_failed'}): ${error.message}` : `recall_attune failed: ${error instanceof Error ? error.message : String(error)}`
        return { content: [{ type: 'text' as const, text }], isError: true }
      }
    },
  )
}

export const recallAttuneTool: AgentToolRegistration = { name: RECALL_ATTUNE_TOOL_NAME, register: registerRecallAttuneTool }
