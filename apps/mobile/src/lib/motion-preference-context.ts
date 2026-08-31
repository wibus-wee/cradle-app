import { createContext, useContext } from 'react'

export const ReduceMotionContext = createContext(false)

export function useReduceMotion() {
  return useContext(ReduceMotionContext)
}
