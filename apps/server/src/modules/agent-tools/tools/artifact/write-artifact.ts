import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { AgentToolHttpRequestError, requestAgentToolJson } from '../../http-client'
import type { AgentToolRegistration } from '../../registry'

export const WRITE_ARTIFACT_TOOL_NAME = 'write_artifact'

export const WRITE_ARTIFACT_TOOL_DESCRIPTION = [
  'Create or update a Cradle Agent Artifact — an interactive JSX view rendered next to chat (Cursor Canvas analogue).',
  'Use when a dashboard, audit, review board, chart, table, or other structured UI is clearer than markdown.',
  'Source MUST be JSX that imports ONLY from "cradle/artifact" (optionally "react") and `export default` a React component.',
  'Available components: Artifact, Header, MetricGrid, MetricCell, Section, SegmentedBar, Table, List, Callout, BarChart, ActionButton, Stack, HStack, Text, Divider.',
  'Pass the same artifactId to update an existing Artifact (revision increments). Omit artifactId to create a new one.',
  'After writing, tell the user the Artifact is available in the side panel; do not dump the full JSX into chat.',
].join(' ')

const WriteArtifactResponseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string(),
  source: z.string(),
  revision: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

function currentChatSessionId(): string | null {
  return process.env.CRADLE_CHAT_SESSION_ID?.trim() || null
}

export interface WriteArtifactToolInput {
  title: string
  source: string
  artifactId?: string
}

export async function executeWriteArtifactTool(input: WriteArtifactToolInput) {
  const chatSessionId = currentChatSessionId()
  if (!chatSessionId) {
    return {
      content: [{
        type: 'text' as const,
        text: 'write_artifact is unavailable because this runtime did not bind a Cradle chat session. No Artifact was written.',
      }],
      isError: true,
    }
  }

  const title = input.title?.trim()
  const source = input.source
  if (!title) {
    return {
      content: [{ type: 'text' as const, text: 'write_artifact requires a non-empty "title".' }],
      isError: true,
    }
  }
  if (typeof source !== 'string' || source.trim().length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'write_artifact requires non-empty JSX "source".' }],
      isError: true,
    }
  }

  try {
    const body: Record<string, string> = {
      chatSessionId,
      title,
      source,
    }
    if (input.artifactId?.trim()) {
      body.artifactId = input.artifactId.trim()
    }

    const record = await requestAgentToolJson({
      path: '/chat-artifacts',
      body,
      responseSchema: WriteArtifactResponseSchema,
    })

    const created = record.revision === 1
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          artifactId: record.id,
          sessionId: record.sessionId,
          title: record.title,
          revision: record.revision,
          source: record.source,
          created,
          updatedAt: record.updatedAt,
        }),
      }],
      structuredContent: {
        artifactId: record.id,
        sessionId: record.sessionId,
        title: record.title,
        revision: record.revision,
        source: record.source,
        created,
        updatedAt: record.updatedAt,
      },
    }
  }
  catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    return {
      content: [{
        type: 'text' as const,
        text: normalized instanceof AgentToolHttpRequestError
          ? `write_artifact failed (${normalized.code ?? 'request_failed'}): ${normalized.message}`
          : `write_artifact failed: ${normalized.message}`,
      }],
      isError: true,
    }
  }
}

function registerWriteArtifactTool(server: McpServer): void {
  server.registerTool(
    WRITE_ARTIFACT_TOOL_NAME,
    {
      title: 'Write Artifact',
      description: WRITE_ARTIFACT_TOOL_DESCRIPTION,
      inputSchema: {
        title: z.string().min(1).describe('Short Artifact title shown in the panel tab and chat card.'),
        source: z.string().min(1).describe(
          'Full JSX source. Import only from "cradle/artifact" (and optionally "react"). Must export default a component.',
        ),
        artifactId: z.string().min(1).optional().describe(
          'Stable id for updates. Omit to create; reuse to revise (revision increments).',
        ),
      },
    },
    executeWriteArtifactTool,
  )
}

export const writeArtifactTool: AgentToolRegistration = {
  name: WRITE_ARTIFACT_TOOL_NAME,
  register: registerWriteArtifactTool,
}
