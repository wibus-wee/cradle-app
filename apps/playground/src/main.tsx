import './styles.css'

import * as React from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app'

// Apply system theme on initial load
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
if (prefersDark) {
  document.documentElement.classList.add('dark')
}

createRoot(document.getElementById('root')!).render(<App />)
