import { useEffect, useMemo } from 'react'

import type { ToolPayload } from '../../../rendering/tool-ui-classifier'
import { readArtifactToolRecord } from '../../lib/artifact-tool-payload'
import type { ArtifactOpenInput } from '../artifact-preview-view'
import { ArtifactPreviewView } from '../artifact-preview-view'

export interface ArtifactSummaryViewProps {
  input: ToolPayload
  output: ToolPayload
  toolCallId: string
  sessionId?: string | null
  onOpenArtifact?: (input: ArtifactOpenInput) => void
  /** Only enabled for a newly-created Artifact during the active run. */
  autoOpen?: boolean
}

/** Live-run keys already auto-opened (avoids remount storms while output settles). */
const autoOpenedArtifactKeys = new Set<string>()

export function ArtifactSummaryView({
  input,
  output,
  toolCallId,
  sessionId,
  onOpenArtifact,
  autoOpen = false,
}: ArtifactSummaryViewProps) {
  const meta = useMemo(() => readArtifactMeta(input, output), [input, output])
  const inputArtifactId = readArtifactToolRecord(input.rawValue)?.artifactId ?? null
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
    if (!autoOpen || !onOpenArtifact || !openPayload || meta.revision !== 1 || inputArtifactId) {
      return
    }
    const key = `${openPayload.sessionId}:${openPayload.artifactId}:${openPayload.revision}`
    if (autoOpenedArtifactKeys.has(key)) {
      return
    }
    autoOpenedArtifactKeys.add(key)
    onOpenArtifact(openPayload)
  }, [autoOpen, inputArtifactId, meta.revision, onOpenArtifact, openPayload])

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
  const fromOutput = readArtifactToolRecord(output.rawValue)
    ?? readArtifactToolRecord(output.rawText)
  const fromInput = readArtifactToolRecord(input.rawValue)

  return {
    artifactId: fromOutput?.artifactId ?? fromInput?.artifactId ?? null,
    sessionId: fromOutput?.sessionId ?? fromInput?.sessionId ?? null,
    title: fromOutput?.title ?? fromInput?.title ?? null,
    source: fromOutput?.source ?? fromInput?.source ?? null,
    revision: fromOutput?.revision
      ?? fromInput?.revision
      ?? null,
  }
}
