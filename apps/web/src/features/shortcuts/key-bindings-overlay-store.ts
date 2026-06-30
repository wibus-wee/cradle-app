import { create } from 'zustand'

interface KeyBindingsOverlayState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
  openOverlay: () => void
  closeOverlay: () => void
}

/**
 * Open state for the `Cmd+/` key-bindings reference overlay.
 *
 * Mirrors the command-palette store pattern so the overlay host can live in
 * the app shell while arbitrary callers (e.g. a future footer hint button) can
 * request it without prop-drilling.
 */
export const useKeyBindingsOverlayStore = create<KeyBindingsOverlayState>(set => ({
  open: false,
  setOpen: open => set({ open }),
  toggle: () => set(state => ({ open: !state.open })),
  openOverlay: () => set({ open: true }),
  closeOverlay: () => set({ open: false }),
}))
