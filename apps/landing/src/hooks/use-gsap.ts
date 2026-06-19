import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

// Register the React integration once.
gsap.registerPlugin(useGSAP)

export { gsap, useGSAP }
