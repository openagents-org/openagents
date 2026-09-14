import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
      dedupe: ['react', 'react-dom', 'sonner', 'radix-ui'],
    alias: {
      '@renderer': resolve('src/renderer'),
        '@': resolve('../../workspace/frontend')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/renderer/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}']
  }
})
