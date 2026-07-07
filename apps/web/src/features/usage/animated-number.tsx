// Spring-driven count-up for headline stats. Uses the `m`/LazyMotion setup
// already registered in app-providers.tsx, so no extra Motion features need
// loading here.
import { m, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { useEffect } from 'react'

interface AnimatedNumberProps {
  value: number
  formatter: (value: number) => string
  className?: string
  dataTestId?: string
}

export function AnimatedNumber({ value, formatter, className, dataTestId }: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion()
  const spring = useSpring(value, { stiffness: 120, damping: 22, mass: 0.9 })
  const display = useTransform(spring, latest => formatter(Math.round(latest)))

  useEffect(() => {
    spring.set(value)
  }, [spring, value])

  if (reduceMotion) {
    return <span className={className} data-testid={dataTestId}>{formatter(value)}</span>
  }

  return <m.span className={className} data-testid={dataTestId}>{display}</m.span>
}
