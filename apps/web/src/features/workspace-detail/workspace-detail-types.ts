export type WorkspaceDetailTab = 'overview' | 'workflow-rules' | 'skills'

export interface WorkspaceDetailDocumentState {
  content: string | null
  loading: boolean
  saving: boolean
  save: (content: string) => Promise<unknown>
}

export interface WorkspaceDetailTocHeading {
  level: number
  text: string
  slug: string
  file: string
}

export interface WorkspaceDetailTocHeadingLayout extends WorkspaceDetailTocHeading {
  top: number
  height: number
  visible: boolean
  intensity: number
}

export interface WorkspaceDetailTocLayout {
  height: number
  activeSlug: string | null
  items: WorkspaceDetailTocHeadingLayout[]
}
