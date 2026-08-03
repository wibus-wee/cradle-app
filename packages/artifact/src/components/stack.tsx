import type { ReactNode } from 'react'

import { cn } from '../cn'

export interface StackProps {
  children?: ReactNode
  className?: string
  gap?: 'sm' | 'md' | 'lg'
}

const GAP: Record<NonNullable<StackProps['gap']>, string> = {
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
}

export function Stack({ children, className, gap = 'md' }: StackProps) {
  return (
    <div className={cn('flex flex-col', GAP[gap], className)}>
      {children}
    </div>
  )
}

export interface TextProps {
  children?: ReactNode
  className?: string
  tone?: 'primary' | 'secondary' | 'tertiary'
  size?: 'sm' | 'md' | 'lg'
  mono?: boolean
}

export function Text({
  children,
  className,
  tone = 'primary',
  size = 'md',
  mono,
}: TextProps) {
  return (
    <span
      className={cn(
        {
          'text-[var(--text-primary)]': tone === 'primary',
          'text-[var(--text-secondary)]': tone === 'secondary',
          'text-[var(--text-tertiary)]': tone === 'tertiary',
          'text-[11px] leading-4': size === 'sm',
          'text-[13px] leading-5': size === 'md',
          'text-[14px] leading-5': size === 'lg',
          'font-mono tabular-nums': mono,
        },
        className,
      )}
    >
      {children}
    </span>
  )
}

export interface DividerProps {
  className?: string
}

export function Divider({ className }: DividerProps) {
  return <hr className={cn('border-0 border-t border-[var(--color-border-content)]', className)} />
}

export interface HStackProps {
  children?: ReactNode
  className?: string
  gap?: 'sm' | 'md' | 'lg'
  align?: 'start' | 'center' | 'end'
}

export function HStack({ children, className, gap = 'md', align = 'center' }: HStackProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap',
        GAP[gap],
        {
          'items-start': align === 'start',
          'items-center': align === 'center',
          'items-end': align === 'end',
        },
        className,
      )}
    >
      {children}
    </div>
  )
}
