/**
 * Bilingual (en / zh) language support for the showcase.
 * Primary language: English.
 *
 * Usage:
 *   const { lang, setLang } = useLang()
 *   t('heroTitle', lang)   // → Cradle-specific string
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type Lang = 'zh' | 'en'

const STORAGE_KEY = 'design-lang'
const URL_PARAM = 'lang'
const CHANGE_EVENT = 'design-lang-change'

function readLang(): Lang {
  if (typeof window === 'undefined') { return 'en' }
  const fromUrl = new URL(window.location.href).searchParams.get(URL_PARAM)
  if (fromUrl === 'zh' || fromUrl === 'en') { return fromUrl }
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'zh' || stored === 'en') { return stored as Lang }
  return navigator.language.startsWith('zh') ? 'zh' : 'en'
}

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb)
  window.addEventListener(CHANGE_EVENT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener(CHANGE_EVENT, cb)
  }
}

export function useLang() {
  const lang = useSyncExternalStore(subscribe, readLang, () => 'en' as Lang)

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    const url = new URL(window.location.href)
    url.searchParams.set(URL_PARAM, next)
    window.history.replaceState(null, '', url)
    window.localStorage.setItem(STORAGE_KEY, next)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return { lang, setLang }
}

type Dict = Record<Lang, string>

export const dict: Record<string, Dict> = {
  // Hero section
  heroEyebrow: { zh: '设计系统 · v0.1', en: 'Design System · v0.1' },
  heroTagline: { zh: 'Cradle 视觉语言 — 精准、高对比度、弹簧物理动画', en: 'Cradle visual language — precise, high-contrast, spring-physics animation.' },
  heroTokenAccent: { zh: '主色', en: 'Accent' },
  heroTokenNeutral: { zh: '中性', en: 'Neutral' },
  heroTokenSans: { zh: '无衬线', en: 'Sans' },
  heroTokenMono: { zh: '等宽', en: 'Mono' },

  // 00 Output Samples
  outputNum: { zh: '00 · 出样', en: '00 · See it' },
  outputTitle: { zh: '输出样本', en: 'Output Samples' },
  outputLede: { zh: '用该设计系统做出的真实页面。', en: 'Real pages produced with this system.' },

  // 01 Manifesto
  manifestoNum: { zh: '01 · 主张', en: '01 · Manifesto' },
  manifestoTitle: { zh: '设计原则', en: 'Design Principles' },
  manifestoLede: { zh: '十条核心约束，构成 Cradle 视觉语言的不变量。', en: 'Ten core invariants that define the Cradle visual language.' },

  // 02 Color
  colorNum: { zh: '02 · 颜色', en: '02 · Color' },
  colorTitle: { zh: '色彩', en: 'Palette' },
  colorLede: { zh: '10 层中性色阶 + 语义主色 + 状态色。', en: '10-tier neutral scale, semantic accents, and status colors.' },
  colorNeutralHead: { zh: '中性', en: 'Neutral' },
  colorAccentHead: { zh: '主色', en: 'Accent' },
  colorSemanticHead: { zh: '语义色', en: 'Semantic' },

  // 03 Typography
  typeNum: { zh: '03 · 字体', en: '03 · Typography' },
  typeTitle: { zh: '字体', en: 'Typography' },
  typeLede: { zh: 'Geist Variable — 为 UI 尺度而生的可变字体。', en: 'Geist Variable — a variable font designed for UI scale.' },
  typeScaleHead: { zh: '尺度', en: 'Scale' },

  // 04 Spacing
  spaceNum: { zh: '04 · 间距', en: '04 · Spacing' },
  spaceTitle: { zh: '间距', en: 'Spacing' },
  spaceLede: { zh: '6 步间距阶梯 + 圆角 + 深度。', en: '6-step spacing scale, border radius, and depth.' },
  radiusHead: { zh: '圆角', en: 'Radius' },
  shadowHead: { zh: '深度', en: 'Depth' },

  // 05 Components
  compNum: { zh: '05 · 组件', en: '05 · Components' },
  compTitle: { zh: '组件', en: 'Components' },
  compLede: { zh: 'Cradle 可用的 UI 原语，全部来自 apps/web/src/components/ui/。', en: 'Available UI primitives from apps/web/src/components/ui/.' },

  // 06 Snippets
  snippetNum: { zh: '06 · 段落', en: '06 · Snippets' },
  snippetTitle: { zh: '段落样例', en: 'Section Snippets' },
  snippetLede: { zh: '可直接插入 scaffold.html 的可复用段落。', en: 'Reusable HTML snippets for scaffold.html mockups.' },

  // 07 Anti-patterns
  antiNum: { zh: '07 · 注意', en: '07 · Anti-Patterns' },
  antiTitle: { zh: '避免的做法', en: 'What to Avoid' },
  antiLede: { zh: 'verify 脚本会自动拦截最严重的几种。', en: 'The verify script blocks the worst ones automatically.' },
  antiDontLabel: { zh: '别这样', en: 'Don\'t' },
  antiDoLabel: { zh: '该这样', en: 'Do' },

  // 08 Decision
  decideNum: { zh: '08 · 速查', en: '08 · Decision' },
  decideTitle: { zh: '快速决策', en: 'Quick Reference' },
  decideLede: { zh: '不确定时先查这张表。', en: 'When in doubt, consult this table.' },

  // 09 Background
  bgNum: { zh: '09 · 由来', en: '09 · Origin' },
  bgTitle: { zh: '设计溯源', en: 'Design Origins' },
  bgLede: { zh: 'Cradle 视觉语言的设计参照与独特主张。', en: 'Where Cradle\'s visual language comes from and what makes it distinct.' },
}

/** Look up a translation key for the given language. Falls back to the key itself. */
export function t(key: string, lang: Lang): string {
  return dict[key]?.[lang] ?? key
}
