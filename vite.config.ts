import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/n9nes9-chipvault/',
  build: {
    target: ['chrome90', 'edge90', 'firefox90', 'safari14'],
  },
  test: {
    environment: 'node',
  },
})
