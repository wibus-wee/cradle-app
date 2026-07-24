import type { GitFileStatus } from '~/features/git/shared/types'

export type ChangeSectionId = 'tests' | 'docs' | 'sources'

export interface ChangeSection {
  id: ChangeSectionId
  files: GitFileStatus[]
}

const CHANGE_SECTIONS: ChangeSectionId[] = ['sources', 'docs', 'tests']

const RE_TEST_FILE = /\.test\.[cm]?[jt]sx?$/i
const RE_MARKDOWN_FILE = /\.mdx?$/i

export function groupGitFileStatuses(files: GitFileStatus[]): ChangeSection[] {
  const sectionFiles: Record<ChangeSectionId, GitFileStatus[]> = {
    tests: [],
    docs: [],
    sources: [],
  }

  for (const file of files) {
    sectionFiles[getChangeSectionId(file.path)].push(file)
  }

  return CHANGE_SECTIONS.map(id => ({
    id,
    files: [...sectionFiles[id]].sort((left, right) => left.path.localeCompare(right.path)),
  }))
}

function getChangeSectionId(path: string): ChangeSectionId {
  if (RE_TEST_FILE.test(path)) {
    return 'tests'
  }
  if (RE_MARKDOWN_FILE.test(path)) {
    return 'docs'
  }
  return 'sources'
}
