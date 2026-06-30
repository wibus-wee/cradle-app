import type { StateStorage } from 'zustand/middleware'
import { createJSONStorage } from 'zustand/middleware'

const memoryStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}

export const persistStorage = createJSONStorage(() => {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      return globalThis.localStorage
    }
  }
  catch {
    // Ignore and fall back to in-memory storage for tests / restricted environments.
  }

  return memoryStorage
})
