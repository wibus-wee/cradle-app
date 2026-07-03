export const spring = {
  fast: {
    type: 'spring',
    stiffness: 520,
    damping: 38,
    mass: 0.7,
    exit: { duration: 0.12 },
  },
  moderate: {
    type: 'spring',
    stiffness: 260,
    damping: 30,
    mass: 0.9,
    bounce: 0.15,
    exit: { duration: 0.16 },
  },
} as const
