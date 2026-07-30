import { create } from 'zustand'

export type GithubRequiredFeature = 'pull-requests' | 'new-work'

interface GithubRequiredDialogState {
  open: boolean
  feature: GithubRequiredFeature | null
  openFor: (feature: GithubRequiredFeature) => void
  close: () => void
}

export const useGithubRequiredDialogStore = create<GithubRequiredDialogState>(set => ({
  open: false,
  feature: null,
  openFor: feature => set({ open: true, feature }),
  close: () => set({ open: false, feature: null }),
}))

export function openGithubRequiredDialog(feature: GithubRequiredFeature): void {
  useGithubRequiredDialogStore.getState().openFor(feature)
}
