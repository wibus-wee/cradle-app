import type { ReviewAgentFixArtifactView } from './types'
import { hashText } from './utils'

function extractFencedDiffArtifact(content: string): string | null {
  const match = /```(?:diff|patch)\s*\n([\s\S]*?)```/i.exec(content)
  if (!match) {
    return null
  }
  const patch = match[1]?.trim()
  return patch && patch.includes('diff --git ') ? `${patch}\n` : null
}

function extractInlineDiffArtifact(content: string): string | null {
  const lines = content.split('\n')
  const startIndex = lines.findIndex(line => line.startsWith('diff --git '))
  if (startIndex < 0) {
    return null
  }
  return `${lines.slice(startIndex).join('\n').trim()}\n`
}

export function buildAgentFixArtifact(input: {
  reviewId: string
  agentFixId: string
  sessionId: string
  runId: string
  content: string
  createdAt: number
}): ReviewAgentFixArtifactView | null {
  const trimmed = input.content.trim()
  if (!trimmed) {
    return null
  }

  const patch = extractFencedDiffArtifact(trimmed) ?? extractInlineDiffArtifact(trimmed)
  const kind: ReviewAgentFixArtifactView['kind'] = patch ? 'patch' : 'assistant-summary'
  const content = patch ?? `${trimmed}\n`
  const contentHash = hashText(content)
  return {
    id: `diff-review-agent-fix-${kind}:${contentHash}`,
    reviewId: input.reviewId,
    agentFixId: input.agentFixId,
    sessionId: input.sessionId,
    runId: input.runId,
    kind,
    mimeType: kind === 'patch' ? 'text/x-patch' : 'text/markdown',
    content,
    contentHash,
    createdAt: input.createdAt,
  }
}
