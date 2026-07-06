import { useEffect, useState } from 'react'

import { ChangelogPage } from './components/changelog'
import { CTASection } from './components/cta-section'
import { FAQ } from './components/faq'
import { AwaitCycleIllustration, FeatureHighlight, MultiAgentIllustration } from './components/feature-highlight'
import { FeaturesSection } from './components/features'
import { Footer } from './components/footer'
import { Hero } from './components/hero'
import { HowItWorks } from './components/how-it-works'
import { Nav } from './components/nav'
import { ProductPreview } from './components/product-preview'

type Route = 'home' | 'changelog'

function useHashRoute(): [Route, () => void] {
  const read = (): Route =>
    window.location.hash.replace(/^#\/?/, '') === 'changelog' ? 'changelog' : 'home'
  const [route, setRoute] = useState<Route>(read)

  useEffect(() => {
    const onHash = () => {
      setRoute(read())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const goHome = () => {
    if (window.location.hash) {
      window.location.hash = ''
    }
 else {
      setRoute('home')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return [route, goHome]
}

export function App() {
  const [route, goHome] = useHashRoute()

  return (
    <div style={{ position: 'relative' }}>
      <Nav />
      {route === 'changelog' ? (
        <main>
          <ChangelogPage onBack={goHome} />
        </main>
      ) : (
        <main>
          <Hero />
          <ProductPreview />
          {/* <SupportStrip /> */}
          <FeaturesSection />
          {/* <Principles /> */}
          <HowItWorks />
          <FeatureHighlight
            eyebrow="Session Await"
            headline={(
              <>
                Your agent pushed a PR. It&rsquo;s waiting for CI.
{' '}
                <span style={{ color: 'var(--text-muted)' }}>You don&rsquo;t have to be.</span>
              </>
            )}
            body={[
              'Set a condition — CI passing, a review approving, a file changing — and Cradle suspends the session. When the condition fires, the agent picks up exactly where it left off.',
              'Close your laptop. The work continues. Cradle resumes, reports, and moves on — no babysitting required.',
            ]}
            illustration={<AwaitCycleIllustration />}
          />
          <FeatureHighlight
            eyebrow="Multi-agent"
            reversed
            headline={(
              <>
                Run four agents on the same codebase.
{' '}
                <span style={{ color: 'var(--text-muted)' }}>At the same time.</span>
              </>
            )}
            body={[
              'Love Claude Code? Run four of them. Cradle orchestrates every agent as a parallel worker — each with its own task, kanban card, and live status.',
              'They don&rsquo;t trip over each other. You don&rsquo;t lose track. One surface, every runner, all moving at once.',
            ]}
            illustration={<MultiAgentIllustration />}
          />
          <FAQ />
          <CTASection />
        </main>
      )}
      <Footer />
    </div>
  )
}
