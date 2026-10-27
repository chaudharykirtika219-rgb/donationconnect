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
    // the live test talks to the separate Supabase TEST project — only via `npm run test:live`
    exclude: (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.npm_lifecycle_event === 'test:live' ? ['**/node_modules/**'] : ['**/node_modules/**', 'supabase/tests/live.*'],
    testTimeout: 30_000,
    // each database suite boots its own WASM Postgres; running files one at a time avoids worker memory crashes
    fileParallelism: false,
  },
})
