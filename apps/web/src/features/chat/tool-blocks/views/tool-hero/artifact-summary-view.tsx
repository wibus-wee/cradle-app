import { useEffect, useMemo } from 'react'

import type { ToolPayload } from '../../../rendering/tool-ui-classifier'
import type { ArtifactOpenInput } from '../artifact-preview-view'
import { ArtifactPreviewView } from '../artifact-preview-view'

export interface ArtifactSummaryViewProps {
  input: ToolPayload
  output: ToolPayload
  toolCallId: string
  sessionId?: string | null
  onOpenArtifact?: (input: ArtifactOpenInput) => void
  /** When true (default), open the Browser Panel once the Artifact meta is ready. */
  autoOpen?: boolean
}

/** Session-scoped keys already auto-opened this page load (avoids remount storms). */
const autoOpenedArtifactKeys = new Set<string>()

export function ArtifactSummaryView({
  input,
  output,
  toolCallId,
  sessionId,
  onOpenArtifact,
  autoOpen = true,
}: ArtifactSummaryViewProps) {
  const meta = useMemo(() => readArtifactMeta(input, output), [input, output])
  const resolvedSessionId = meta.sessionId ?? sessionId ?? null

  const openPayload = useMemo((): ArtifactOpenInput | null => {
    if (!meta.artifactId || !resolvedSessionId) {
      return null
    }
    return {
      sessionId: resolvedSessionId,
      artifactId: meta.artifactId,
      toolCallId,
      title: meta.title ?? 'Artifact',
      source: meta.source ?? '',
      revision: meta.revision ?? 1,
    }
  }, [meta.artifactId, meta.revision, meta.source, meta.title, resolvedSessionId, toolCallId])

  useEffect(() => {
    if (!autoOpen || !onOpenArtifact || !openPayload) {
      return
    }
    const key = `${openPayload.sessionId}:${openPayload.artifactId}:${openPayload.revision}`
    if (autoOpenedArtifactKeys.has(key)) {
      return
    }
    autoOpenedArtifactKeys.add(key)
    onOpenArtifact(openPayload)
  }, [autoOpen, onOpenArtifact, openPayload])

  if (!openPayload) {
    return null
  }

  return (
    <ArtifactPreviewView
      sessionId={openPayload.sessionId}
      artifactId={openPayload.artifactId}
      toolCallId={toolCallId}
      title={openPayload.title}
      source={openPayload.source}
      revision={openPayload.revision}
      onOpen={onOpenArtifact}
    />
  )
}

function readArtifactMeta(input: ToolPayload, output: ToolPayload): {
  artifactId: string | null
  sessionId: string | null
  title: string | null
  source: string | null
  revision: number | null
} {
  const fromOutput = readArtifactRecord(output.rawValue)
    ?? readArtifactRecordFromText(output.rawText)
  const fromInput = readArtifactRecord(input.rawValue)

  return {
    artifactId: fromOutput?.artifactId
      ?? fromInput?.artifactId
      ?? readStringField(output, 'artifactId')
      ?? readStringField(input, 'artifactId')
      ?? null,
    sessionId: fromOutput?.sessionId
      ?? fromInput?.sessionId
      ?? readStringField(output, 'sessionId')
      ?? readStringField(input, 'sessionId')
      ?? null,
    title: fromOutput?.title
      ?? fromInput?.title
      ?? readStringField(output, 'title')
      ?? readStringField(input, 'title')
      ?? null,
    source: fromOutput?.source
      ?? fromInput?.source
      ?? readStringField(output, 'source')
      ?? readStringField(input, 'source')
      ?? null,
    revision: fromOutput?.revision
      ?? fromInput?.revision
      ?? null,
  }
}

function readArtifactRecord(value: unknown): {
  artifactId?: string
  sessionId?: string
  title?: string
  source?: string
  revision?: number
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    // MCP text content is often `[{ type: 'text', text: '{...}' }]`
    if (Array.isArray(value)) {
      for (const block of value) {
        if (block && typeof block === 'object' && 'text' in block && typeof (block as { text: unknown }).text === 'string') {
          const parsed = readArtifactRecordFromText((block as { text: string }).text)
          if (parsed) {
            return parsed
          }
        }
      }
    }
    return null
  }
  const record = value as Record<string, unknown>
  const artifactId = typeof record.artifactId === 'string'
    ? record.artifactId
    : typeof record.id === 'string'
      ? record.id
      : undefined
  const source = typeof record.source === 'string' ? record.source : undefined
  // Metadata-only tool results still identify the Artifact without echoing JSX.
  if (!artifactId && !source) {
    return null
  }
  return {
    artifactId,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    title: typeof record.title === 'string' ? record.title : undefined,
    source,
    revision: typeof record.revision === 'number' ? record.revision : undefined,
  }
}

function readArtifactRecordFromText(text: string | null): ReturnType<typeof readArtifactRecord> {
  if (!text?.trim()) {
    return null
  }
  try {
    return readArtifactRecord(JSON.parse(text))
  }
  catch {
    return null
  }
}

function readStringField(payload: ToolPayload, key: 'artifactId' | 'sessionId' | 'title' | 'source'): string | null {
  const record = payload.rawValue
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null
  }
  const value = (record as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}
