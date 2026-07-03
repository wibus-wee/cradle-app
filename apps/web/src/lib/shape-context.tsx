import { createContext, useContext } from 'react'

export interface ShapeTokens {
  bg: string
  focusRing: string
  item: string
}

const defaultShape: ShapeTokens = {
  bg: 'rounded-lg',
  focusRing: 'rounded-[10px]',
  item: 'rounded-lg',
}

const ShapeContext = createContext<ShapeTokens>(defaultShape)

export const ShapeProvider = ShapeContext.Provider

export function useShape(): ShapeTokens {
  return useContext(ShapeContext)
}
