import { RightSmallLine as ChevronRightIcon } from '@mingcute/react'
import type { ComponentType, SVGProps } from 'react'
import { createContext, useContext } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string
  strokeWidth?: number | string
}

const iconRegistry = {
  'chevron-right': ChevronRightIcon as ComponentType<IconProps>,
} satisfies Record<string, ComponentType<IconProps>>

const IconContext = createContext<Record<string, ComponentType<IconProps>>>(iconRegistry)

export const IconProvider = IconContext.Provider

export function useIcon(name: keyof typeof iconRegistry | string): ComponentType<IconProps> {
  const icons = useContext(IconContext)
  return icons[name] ?? iconRegistry['chevron-right']
}
