import type { GitFileStatus } from '~/features/git/types'

type ChangeSectionId = 'tests' | 'docs' | 'sources'

export interface ChangeSection {
  id: ChangeSectionId
  label: string
  files: GitFileStatus[]
}

const CHANGE_SECTIONS: Array<{ id: ChangeSectionId, label: string }> = [
  { id: 'sources', label: 'Sources' },
  { id: 'docs', label: 'Docs / Specs' },
  { id: 'tests', label: 'Tests' },
]

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

  return CHANGE_SECTIONS.map(section => ({
    ...section,
    files: [...sectionFiles[section.id]].sort((left, right) => left.path.localeCompare(right.path)),
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
