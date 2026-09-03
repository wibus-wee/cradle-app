export function workspacePathName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? 'Files'
}

export function workspaceFileSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B` }
  if (bytes < 1024 * 1024) { return `${Math.ceil(bytes / 1024)} KB` }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function workspaceFilePreviewUnavailableDescription(
  bytes: number,
  previewable: boolean,
): string {
  if (bytes > 128 * 1024) { return 'Text previews are limited to 128 KB on Mobile.' }
  if (previewable) { return 'Text content is unavailable.' }
  return 'This file type does not have a Mobile preview.'
}
