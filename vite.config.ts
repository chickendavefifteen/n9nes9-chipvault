import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/n9nes9-chipvault/',
  test: {
    environment: 'node',
  },
})
