import { join, normalize } from 'pathe'
import { z } from 'zod'

const WORKSPACE_FILE_DRAG_MIME = 'application/x-cradle-workspace-file+json'
const WorkspaceFileDragPayloadJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    absolutePath: z.string().min(1).optional(),
    relativePath: z.string().min(1),
  }))

export interface WorkspaceFileDragPayload {
  absolutePath?: string
  relativePath: string
}

interface WorkspaceFileDragInput {
  relativePath: string
  workspacePath?: string | null
}

export function quoteWorkspacePath(path: string): string {
  const normalized = normalize(path)
  return normalized.includes(' ') ? `"${normalized}"` : normalized
}

export function serializeWorkspaceFileDragPayload({ relativePath, workspacePath }: WorkspaceFileDragInput): WorkspaceFileDragPayload {
  return {
    relativePath: normalize(relativePath),
    absolutePath: workspacePath ? normalize(join(workspacePath, relativePath)) : undefined,
  }
}

export function writeWorkspaceFileDragData(dataTransfer: DataTransfer, payload: WorkspaceFileDragPayload): void {
  dataTransfer.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify(payload))
  dataTransfer.setData('text/plain', quoteWorkspacePath(payload.absolutePath ?? payload.relativePath))
}

export function readWorkspaceFileDragText(dataTransfer: DataTransfer): string | null {
  const rawPayload = dataTransfer.getData(WORKSPACE_FILE_DRAG_MIME)
  if (rawPayload) {
    const payload = WorkspaceFileDragPayloadJsonSchema.parse(rawPayload)
    return quoteWorkspacePath(payload.absolutePath ?? payload.relativePath)
  }

  return dataTransfer.getData('text/plain') || null
}
