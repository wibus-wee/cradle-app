import { realpathSync, statSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import { AppError } from '../../errors/app-error'

export interface ResolvedRootBoundary {
  requestedPath: string
  realPath: string
}

export function isPathWithinRoot(rootDir: string, targetPath: string): boolean {
  const normalizedRoot = resolve(rootDir)
  const normalizedTarget = resolve(targetPath)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${sep}`)
}

export async function resolveDirectoryBoundary(
  requestedPath: string,
  errorDetails: Record<string, unknown>,
): Promise<ResolvedRootBoundary> {
  const realPath = await realpath(requestedPath)
  const realStat = await stat(realPath)
  if (!realStat.isDirectory()) {
    throw new AppError({
      code: 'filesystem_not_directory',
      status: 400,
      message: 'Path is not a directory',
      details: { ...errorDetails, path: requestedPath },
    })
  }
  return { requestedPath: resolve(requestedPath), realPath }
}

export function resolveDirectoryBoundarySync(
  requestedPath: string,
  errorDetails: Record<string, unknown>,
): ResolvedRootBoundary {
  const realPath = realpathSync(requestedPath)
  const realStat = statSync(realPath)
  if (!realStat.isDirectory()) {
    throw new AppError({
      code: 'filesystem_not_directory',
      status: 400,
      message: 'Path is not a directory',
      details: { ...errorDetails, path: requestedPath },
    })
  }
  return { requestedPath: resolve(requestedPath), realPath }
}

export function assertWithinAllowedRoots(input: {
  target: ResolvedRootBoundary
  roots: ResolvedRootBoundary[]
  code: string
  message: string
  details?: Record<string, unknown>
}): void {
  if (input.roots.some(root => isPathWithinRoot(root.realPath, input.target.realPath))) {
    return
  }

  throw new AppError({
    code: input.code,
    status: 403,
    message: input.message,
    details: {
      ...input.details,
      path: input.target.requestedPath,
    },
  })
}
