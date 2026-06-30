import { create } from 'zustand'

interface GlobalSearchState {
  open: boolean
  initialQuery: string
  setOpen: (open: boolean) => void
  openPalette: (initialQuery?: string) => void
  openSearch: () => void
  closeSearch: () => void
}

export const useGlobalSearchStore = create<GlobalSearchState>(set => ({
  open: false,
  initialQuery: '>',
  setOpen: open => set({ open }),
  openPalette: (initialQuery = '>') => set({ initialQuery, open: true }),
  openSearch: () => set({ initialQuery: '', open: true }),
  closeSearch: () => set({ open: false }),
}))
