import { Suspense, useEffect, useState } from 'react'

import { CTASection } from './components/cta-section'
import { DetailsSection } from './components/details'
import { FAQ } from './components/faq'
import { AwaitCycleIllustration, FeatureHighlight, MultiAgentIllustration } from './components/feature-highlight'
import { FeaturesSection } from './components/features'
import { Footer } from './components/footer'
import { Hero } from './components/hero'
import { HowItWorks } from './components/how-it-works'
import { Nav } from './components/nav'
import { ProductPreview } from './components/product-preview'
import { BlogPage, BlogPostPage, ChangelogPage } from './lazy-routes'

type Route = { name: 'home' } | { name: 'changelog' } | { name: 'blog' } | { name: 'blog-post', slug: string }

function parseRoute(): Route {
  const path = window.location.hash.replace(/^#\/?/, '')
  if (path === 'changelog') { return { name: 'changelog' } }
  if (path === 'blog') { return { name: 'blog' } }
  const postMatch = /^blog\/([\w-]+)$/.exec(path)
  if (postMatch) { return { name: 'blog-post', slug: postMatch[1] } }
  return { name: 'home' }
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseRoute)

  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return route
}

export function App() {
  const route = useHashRoute()
  const routeContent = route.name === 'changelog'
    ? (
        <main>
          <ChangelogPage />
        </main>
      )
    : route.name === 'blog'
      ? (
          <main>
            <BlogPage />
          </main>
        )
      : route.name === 'blog-post'
        ? (
            <main>
              <BlogPostPage slug={route.slug} />
            </main>
          )
        : (
        <main>
          <Hero />
          <ProductPreview />
          {/* <SupportStrip /> */}
          <FeaturesSection />
          {/* <Principles /> */}
          <HowItWorks />
          <DetailsSection />
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
      )

  return (
    <div style={{ position: 'relative' }}>
      <Nav />
      <Suspense fallback={<main style={{ minHeight: '70vh' }} />}>
        {routeContent}
      </Suspense>
      <Footer />
    </div>
  )
}
