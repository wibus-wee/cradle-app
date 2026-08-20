import { lazy } from 'react'

const loadBlogPage = () => import('./components/blog').then(module => ({ default: module.BlogPage }))
const loadBlogPostPage = () => import('./components/blog-post').then(module => ({ default: module.BlogPostPage }))
const loadChangelogPage = () => import('./components/changelog').then(module => ({ default: module.ChangelogPage }))

export const BlogPage = lazy(loadBlogPage)
export const BlogPostPage = lazy(loadBlogPostPage)
export const ChangelogPage = lazy(loadChangelogPage)

export function preloadLandingRoute(href: string): void {
  if (href.startsWith('#/blog/')) {
    void loadBlogPostPage().catch(() => {})
  }
  else if (href === '#/blog') {
    void loadBlogPage().catch(() => {})
  }
  else if (href === '#/changelog') {
    void loadChangelogPage().catch(() => {})
  }
}
