import type { Metadata } from 'next'

import { BentoFeatures } from '@/components/home/bento-features'
import { CTA } from '@/components/home/cta'
import { Hero } from '@/components/home/hero'
import { ProductShowcase } from '@/components/home/product-showcase'
import { UserScenarios } from '@/components/home/user-scenarios'

export const metadata: Metadata = {
  title: 'Cradle',
  description:
    'The AI agent platform for developers. Chat, automate, delegate issues, and extend with plugins — all running locally.',
}

function Divider() {
  return (
    <div className="mx-auto max-w-6xl px-6 lg:px-8">
      <div className="h-px bg-fd-border/40" />
    </div>
  )
}

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <Hero />
      <Divider />
      <ProductShowcase />
      <Divider />
      <BentoFeatures />
      <Divider />
      <UserScenarios />
      <Divider />
      <CTA />
    </div>
  )
}
