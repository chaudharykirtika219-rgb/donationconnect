/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Only the 3D libraries go in the three chunk, so pages without WebGL never download it.
        manualChunks(id) {
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'react'
          if (/node_modules[\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run|@babel)[\/]/.test(id)) return 'react'
          if (/node_modules[\/](three|three-stdlib|@react-three|troika|camera-controls|maath|meshline|stats-gl)/.test(id)) return 'three'
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
})
