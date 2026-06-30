/**
 * Bilingual (zh / en) language support for the showcase.
 *
 * Copy this file to showcase/src/i18n.ts.
 * Then extend the `dict` object with your project's copy.
 *
 * Usage:
 *   const { lang, setLang } = useLang()
 *   t('heroTitle', lang)   // → project-specific zh or en string
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type Lang = 'zh' | 'en'

const STORAGE_KEY = 'design-lang'
const URL_PARAM = 'lang'
const CHANGE_EVENT = 'design-lang-change'

function readLang(): Lang {
  if (typeof window === 'undefined') return 'zh'
  const fromUrl = new URL(window.location.href).searchParams.get(URL_PARAM)
  if (fromUrl === 'zh' || fromUrl === 'en') return fromUrl
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'zh' || stored === 'en') return stored as Lang
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
  const lang = useSyncExternalStore(subscribe, readLang, () => 'zh' as Lang)

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

/**
 * CUSTOMIZE: Replace all placeholder strings with your project's actual copy.
 * Keep both `zh` and `en` keys in sync.
 */
export const dict: Record<string, Dict> = {
  // Hero section
  heroEyebrow:        { zh: '设计系统 · v0.1',  en: 'Design System · v0.1' },
  heroTagline:        { zh: '一句话描述你的设计语言', en: 'One-line description of your design language.' },
  heroTokenAccent:    { zh: '主色',   en: 'Accent' },
  heroTokenNeutral:   { zh: '中性',   en: 'Neutral' },
  heroTokenSerif:     { zh: '衬线',   en: 'Serif' },
  heroTokenMono:      { zh: '等宽',   en: 'Mono' },

  // 00 Output Samples
  outputNum:          { zh: '00 · 出样',  en: '00 · See it' },
  outputTitle:        { zh: '输出样本',   en: 'Output Samples' },
  outputLede:         { zh: '用该设计系统做出的真实页面。', en: 'Real pages produced with this system.' },

  // 01 Manifesto
  manifestoNum:       { zh: '01 · 主张',  en: '01 · Manifesto' },
  manifestoTitle:     { zh: '设计原则',   en: 'Design Principles' },
  manifestoLede:      { zh: '核心约束。', en: 'Core constraints.' },

  // 02 Color
  colorNum:           { zh: '02 · 颜色',  en: '02 · Color' },
  colorTitle:         { zh: '色彩',       en: 'Palette' },
  colorLede:          { zh: '色彩说明。', en: 'Color description.' },
  colorNeutralHead:   { zh: '中性',       en: 'Neutral' },
  colorAccentHead:    { zh: '主色',       en: 'Accent' },
  colorSemanticHead:  { zh: '语义色',     en: 'Semantic' },

  // 03 Typography
  typeNum:            { zh: '03 · 字体',  en: '03 · Typography' },
  typeTitle:          { zh: '字体',       en: 'Typography' },
  typeLede:           { zh: '字体说明。', en: 'Typography description.' },
  typeScaleHead:      { zh: '尺度',       en: 'Scale' },

  // 04 Spacing
  spaceNum:           { zh: '04 · 间距',  en: '04 · Spacing' },
  spaceTitle:         { zh: '间距',       en: 'Spacing' },
  spaceLede:          { zh: '间距说明。', en: 'Spacing description.' },
  radiusHead:         { zh: '圆角',       en: 'Radius' },
  shadowHead:         { zh: '深度',       en: 'Depth' },

  // 05 Components
  compNum:            { zh: '05 · 组件',  en: '05 · Components' },
  compTitle:          { zh: '组件',       en: 'Components' },
  compLede:           { zh: '组件说明。', en: 'Components description.' },

  // 06 Snippets
  snippetNum:         { zh: '06 · 段落',  en: '06 · Snippets' },
  snippetTitle:       { zh: '段落样例',   en: 'Section Snippets' },
  snippetLede:        { zh: '可复用的段落。', en: 'Reusable section snippets.' },

  // 07 Anti-patterns
  antiNum:            { zh: '07 · 注意',  en: '07 · Anti-Patterns' },
  antiTitle:          { zh: '避免的做法', en: 'What to Avoid' },
  antiLede:           { zh: 'verify 脚本会自动拦截最严重的几种。', en: 'The verify script blocks the worst mechanically.' },
  antiDontLabel:      { zh: '别这样',     en: "Don't" },
  antiDoLabel:        { zh: '该这样',     en: 'Do' },

  // 08 Decision
  decideNum:          { zh: '08 · 速查',  en: '08 · Decision' },
  decideTitle:        { zh: '快速决策',   en: 'Quick Reference' },
  decideLede:         { zh: '不确定时先查这张表。', en: 'When in doubt, consult this table first.' },

  // 09 Background
  bgNum:              { zh: '09 · 由来',  en: '09 · Origin' },
  bgTitle:            { zh: '它从哪来',   en: 'Design Origins' },
}

/** Look up a translation key for the given language. Falls back to the key itself. */
export function t(key: string, lang: Lang): string {
  return dict[key]?.[lang] ?? key
}
