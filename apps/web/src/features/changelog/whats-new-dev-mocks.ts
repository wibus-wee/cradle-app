// ── Dev-only What's New mocks ────────────────────────────────────────────────
// Preview fixtures for the What's New surfaces (corner popup + dialog).
//
// - Loaded ONLY in dev: this module is dynamically imported behind
//   `import.meta.env.DEV` guards in `use-changelog.ts`, so it is code-split
//   out of production builds entirely.
// - To add a preview, append an entry below. To remove the mock entirely,
//   delete this file and the two guarded call sites in `use-changelog.ts`.
// - A dismissed announcement stays dismissed: to re-show the popup, clear the
//   `cradle:whats-new:v1` key in localStorage, or bump the mock `version`.
import type { ChangelogEntry } from './use-changelog'
import type { FeatureTip } from './use-feature-tips'

export const devMockFeatureTips: FeatureTip[] = [
  {
    id: 'dev-mock-tip-split-workspace',
    showAfter: '2026-07-01',
    title: {
      zh: '并排处理多个会话',
      en: 'Work on sessions side by side',
    },
    body: {
      zh: `把聊天表面拆分成多个窗格，一边看 Agent 工作一边继续提需求。Cradle Split 让你在同一个工作区里同时处理多个会话。你会发现，Agent 的工作效率比你想象的更高

除此之外，你还可以直接新建窗口，多窗口并行处理多个会话。`,
      en: `Split the chat surface into multiple panes, so you can keep an eye on your Agent while continuing to make requests.

Beyond that, you can also open a new window and work on multiple sessions in parallel.`,
    },
    cta: {
      zh: '试一下',
      en: 'Try it',
    },
    url: '/chat/new',
  },
  {
    id: 'dev-mock-tip-external-link',
    showAfter: '2026-07-01',
    title: {
      zh: '阅读发布说明',
      en: 'Read the release notes',
    },
    body: {
      zh: '外部链接会在浏览器中打开，适合引导到[文档](https://app.cradle.wibus.ren)或落地页。',
      en: 'External links open in the browser — handy for [docs](https://app.cradle.wibus.ren) or landing pages.',
    },
    url: 'https://app.cradle.wibus.ren',
  },
]

export const devMockChangelogEntries: ChangelogEntry[] = [
  {
    version: 'dev-mock-20260723.1',
    date: '2026-07-23',
    announce: true,
    showAfter: '2026-07-01',
    languages: ['zh', 'en'],
    title: {
      zh: '角落公告与全新 What\'s New',
      en: 'Corner Announcements & a New What\'s New',
    },
    summary: {
      zh: '新版本现在会在右下角弹出定时公告卡片，What\'s New 对话框也支持版本列表浏览。',
      en: 'Releases can now surface as a timed corner card, and the What\'s New dialog gains a version rail.',
    },
    markdown: {
      zh: `> 一条用于预览的模拟更新，仅出现在开发模式。

## ✨ New

- 右下角定时公告卡片：新版本可配置为自动弹出，悬停暂停倒计时。
- What's New 对话框新增版本列表，可回看任意历史版本。

## 💎 Improvements

- 公告只出现一次，关闭后不再打扰。`,
      en: `> A mock release for preview purposes — dev mode only.

## ✨ New

- Timed corner announcement card: releases can opt into an auto-appearing card, with hover-to-pause countdown.
- The What's New dialog gains a version rail for browsing past releases.

## 💎 Improvements

- Announcements appear once and never again after dismissal.`,
    },
  },
  {
    version: 'dev-mock-20260710.1',
    date: '2026-07-10',
    languages: ['zh', 'en'],
    title: {
      zh: '模拟历史版本（无公告）',
      en: 'Mock Older Release (No Announcement)',
    },
    summary: {
      zh: '这条不会弹出公告，用于演示版本列表的选中切换。',
      en: 'This one never pops up — it exists to demo rail selection.',
    },
    markdown: {
      zh: `> 较早的模拟版本，用于演示版本列表。

## 🐞 Fixes

- 修复了一个并不存在的问题。`,
      en: `> An older mock release, here to fill the version rail.

## 🐞 Fixes

- Fixed a problem that never existed.`,
    },
  },
]
