export interface ArtifactToolRecord {
  artifactId?: string
  sessionId?: string
  title?: string
  source?: string
  revision?: number
}

const MAX_ARTIFACT_PAYLOAD_DEPTH = 6

/**
 * Artifact results can be wrapped by the Cradle tool envelope, MCP response,
 * structured content, or text content. Normalize those shapes at one boundary
 * so the preview and hero-content checks cannot disagree.
 */
export function readArtifactToolRecord(value: unknown): ArtifactToolRecord | null {
  return readArtifactToolRecordAtDepth(value, 0)
}

function readArtifactToolRecordAtDepth(value: unknown, depth: number): ArtifactToolRecord | null {
  if (depth > MAX_ARTIFACT_PAYLOAD_DEPTH || value == null) {
    return null
  }

  if (typeof value === 'string') {
    try {
      return readArtifactToolRecordAtDepth(JSON.parse(value), depth + 1)
    }
    catch {
      return null
    }
  }

  if (Array.isArray(value)) {
    for (const block of value) {
      if (!isRecord(block)) {
        continue
      }
      const nestedText = block.text
      if (typeof nestedText === 'string') {
        const record = readArtifactToolRecordAtDepth(nestedText, depth + 1)
        if (record) {
          return record
        }
      }
    }
    return null
  }

  if (!isRecord(value)) {
    return null
  }

  const direct = readDirectArtifactRecord(value)
  if (direct) {
    return direct
  }

  for (const nested of [value.structuredContent, value.result, value.content]) {
    const record = readArtifactToolRecordAtDepth(nested, depth + 1)
    if (record) {
      return record
    }
  }

  return null
}

function readDirectArtifactRecord(value: Record<string, unknown>): ArtifactToolRecord | null {
  const artifactId = readString(value.artifactId) ?? readString(value.id)
  const source = readString(value.source)
  if (!artifactId && !source) {
    return null
  }

  return {
    artifactId: artifactId ?? undefined,
    sessionId: readString(value.sessionId) ?? undefined,
    title: readString(value.title) ?? undefined,
    source: source ?? undefined,
    revision: typeof value.revision === 'number' ? value.revision : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
