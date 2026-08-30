import type { FilePreviewViewProps } from './FilePreviewView'

export const markdownFilePreviewFixture: FilePreviewViewProps = {
  file: {
    name: 'README.md',
    path: 'README.md',
    size: 1842,
    modifiedAt: 1_750_000_000_000,
    mimeType: 'text/markdown; charset=utf-8',
    extension: '.md',
    previewKind: 'markdown',
  },
  content: '# Cradle\n\nRun the workspace from the repository root.',
  onShare: () => {},
}

export const unsupportedFilePreviewFixture: FilePreviewViewProps = {
  file: {
    name: 'architecture.pdf',
    path: 'docs/architecture.pdf',
    size: 48_000,
    modifiedAt: 1_750_000_000_000,
    mimeType: 'application/pdf',
    extension: '.pdf',
    previewKind: 'pdf',
  },
  content: null,
  onShare: () => {},
}
