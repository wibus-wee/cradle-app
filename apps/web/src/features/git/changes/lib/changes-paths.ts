export function joinRepositoryPath(repositoryPath: string, path: string): string {
  if (repositoryPath === '.') {
    return path
  }
  return path ? `${repositoryPath}/${path}` : repositoryPath
}

export function stripRepositoryPath(
  repositoryPath: string,
  workspaceRelativePath: string,
): string {
  if (repositoryPath === '.') {
    return workspaceRelativePath
  }
  if (workspaceRelativePath === repositoryPath) {
    return ''
  }
  const prefix = `${repositoryPath}/`
  return workspaceRelativePath.startsWith(prefix)
    ? workspaceRelativePath.slice(prefix.length)
    : workspaceRelativePath
}

export function getWorkspaceDiffRepositoryPath(
  repositoryPath: string,
  repositoryCount: number,
): string | undefined {
  return repositoryPath === '.' && repositoryCount === 1
    ? undefined
    : repositoryPath
}
