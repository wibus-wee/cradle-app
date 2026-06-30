import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Copy this file to showcase/src/main.tsx — no modification needed.

import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
