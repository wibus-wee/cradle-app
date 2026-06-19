import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: command === 'build'
? {
    'process.env.NODE_ENV': JSON.stringify('production'),
  }
: undefined,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) {
            return 'react'
          }
          if (id.includes('/node_modules/motion/') || id.includes('/node_modules/framer-motion/') || id.includes('/node_modules/gsap/') || id.includes('/node_modules/@gsap/react/')) {
            return 'animation'
          }
          if (id.includes('/node_modules/lucide-react/')) {
            return 'icons'
          }
        },
      },
    },
  },
}))
