import { z } from 'zod'

const ToolInputPayloadSchema = z.object({
  input: z.record(z.string(), z.unknown()),
})

const SinglePathToolFields: Readonly<Record<string, readonly string[]>> = {
  Edit: ['file_path'],
  MultiEdit: ['file_path'],
  Read: ['file_path'],
  Write: ['file_path'],
  apply_patch: ['path'],
  edit_file: ['path', 'filePath'],
  read_file: ['path', 'filePath'],
  write_file: ['path', 'filePath'],
}

const MultiPathToolFields: Readonly<Record<string, readonly string[]>> = {
  file_change: ['filenames'],
}

/**
 * Converts only documented tool-input fields into Recall file facts. Shell
 * commands and unrecognized provider payloads intentionally produce no rows.
 */
export function extractRecallFileTouchPaths(input: {
  phase: string
  toolName: string | null
  payloadJson: string
}): string[] {
  if (input.phase !== 'tool_call_input_available' || !input.toolName) {
    return []
  }

  const payload = parseToolInputPayload(input.payloadJson)
  if (!payload) {
    return []
  }

  const paths = [
    ...readSinglePaths(payload.input, SinglePathToolFields[input.toolName] ?? []),
    ...readPathArrays(payload.input, MultiPathToolFields[input.toolName] ?? []),
  ]
  return [...new Set(paths.map(normalizeRecallFilePath).filter((path): path is string => path !== null))]
}

function parseToolInputPayload(payloadJson: string): z.infer<typeof ToolInputPayloadSchema> | null {
  try {
    return ToolInputPayloadSchema.safeParse(JSON.parse(payloadJson)).data ?? null
  }
  catch {
    return null
  }
}

function readSinglePaths(input: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.flatMap((field) => {
    const value = input[field]
    return typeof value === 'string' ? [value] : []
  })
}

function readPathArrays(input: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.flatMap((field) => {
    const value = input[field]
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  })
}

export function normalizeRecallFilePath(value: string): string | null {
  const path = value.trim().replaceAll('\\', '/')
  if (!path || path.includes('\0')) {
    return null
  }
  return path.startsWith('./') ? path.slice(2) : path
}
