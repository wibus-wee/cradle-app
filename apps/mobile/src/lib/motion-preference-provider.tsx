import type { PropsWithChildren } from 'react'
import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

import { ReduceMotionContext } from './motion-preference-context'

export function MotionPreferenceProvider({ children }: PropsWithChildren) {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    let mounted = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) {
        setReduceMotion(enabled)
      }
    })
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    )
    return () => {
      mounted = false
      subscription.remove()
    }
  }, [])

  return <ReduceMotionContext value={reduceMotion}>{children}</ReduceMotionContext>
}
