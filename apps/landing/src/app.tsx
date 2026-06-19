import { CTASection } from './components/cta-section'
import { ComparisonSection } from './components/comparison'
import { Features } from './components/features'
import { Footer } from './components/footer'
import { Hero } from './components/hero'
import { HowItWorksSection } from './components/how-it-works'
import { Nav } from './components/nav'
import { ProblemSection } from './components/problem'
import { StatsSection } from './components/stats'
import { IntersectionLayout } from './components/blueprint-annotations'

export function App() {
  return (
    <IntersectionLayout>
      <Nav />
      <main>
        <Hero />
        <ProblemSection />
        {/* <StatsSection /> */}
        {/* <Features /> */}
        {/* <HowItWorksSection /> */}
        {/* <ComparisonSection /> */}
        <CTASection />
      </main>
      <Footer />
    </IntersectionLayout>
  )
}
