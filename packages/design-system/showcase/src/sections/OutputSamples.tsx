import { useEffect, useRef, useState } from 'react'

import type { Lang } from '../i18n'
import { t } from '../i18n'

interface OutputSamplesProps {
  lang: Lang
}

interface DemoCard {
  id: string
  title: string
  desc: string
  url: string
}

const DEMOS: DemoCard[] = [
  {
    id: 'post',
    title: 'Long-form post',
    desc: 'Article layout — "Building the AI-Native Desktop"',
    url: '/demos/demo-post.html',
  },
  {
    id: 'post-en',
    title: 'Long-form post (EN)',
    desc: 'Same article in English',
    url: '/demos/demo-post.en.html',
  },
]

const PAGE_WIDTH = 794 // A4 / typical article page width

function DemoCardView({ card }: { card: DemoCard }) {
  const frameRef = useRef<HTMLAnchorElement>(null)
  const [scale, setScale] = useState(0.35)

  useEffect(() => {
    if (!frameRef.current) { return }
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) { setScale(w / PAGE_WIDTH) }
    })
    observer.observe(frameRef.current)
    return () => observer.disconnect()
  }, [])

  const iframeH = Math.round(PAGE_WIDTH * 1.414) // A4 aspect ratio

  return (
    <div className="demo-card">
      <a
        ref={frameRef}
        href={card.url}
        target="_blank"
        rel="noopener noreferrer"
        className="demo-card__frame"
      >
        <div className="demo-card__viewport">
          <iframe
            className="demo-card__iframe"
            src={card.url}
            width={PAGE_WIDTH}
            height={iframeH}
            style={{ transform: `scale(${scale})`, height: iframeH }}
            title={card.title}
            loading="lazy"
          />
        </div>
        <div className="demo-card__shield" />
        <span className="demo-card__open">↗</span>
      </a>
      <p className="demo-card__title">{card.title}</p>
      <p className="demo-card__desc">{card.desc}</p>
    </div>
  )
}

export default function OutputSamples({ lang }: OutputSamplesProps) {
  return (
    <section className="section">
      <div className="section-head">
        <p className="section-num">{t('outputNum', lang)}</p>
        <h2 className="section-title">{t('outputTitle', lang)}</h2>
        <p className="section-lede">{t('outputLede', lang)}</p>
      </div>

      <div className="demo-grid">
        {DEMOS.map(card => (
          <DemoCardView key={card.id} card={card} />
        ))}
      </div>
    </section>
  )
}
