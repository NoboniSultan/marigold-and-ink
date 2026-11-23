/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the site runs on :5173 and the API on :3000. The proxy forwards /api and
// /media to the API, so the browser sees one origin, exactly like production (where Express
// serves this build). Same origin means the session cookie just works and needs no CORS.
const API = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/media': { target: API, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The Explore chunk (three.js + React Three Fiber, ~285 KB gzipped) is large by nature,
    // but it is code-split and only downloaded when someone opens Explore.
    chunkSizeWarningLimit: 1100,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx', // entry point: only mounts <App />
        'src/vite-env.d.ts',
        // The 3D sketchbook needs WebGL and a 2D canvas, which jsdom doesn't have; it's checked
        // in a real browser (PR checklist). Its arithmetic (explore/sketchbook.ts) is unit-tested.
        'src/features/gallery/explore/ExploreCanvas.tsx',
        'src/features/gallery/explore/Sketchbook.tsx',
        'src/features/gallery/explore/pageTextures.ts',
      ],
      reporter: ['text', 'html', 'lcov'],
      // `npm run test:coverage` (and therefore CI) fails if coverage drops below these: a
      // floor just under what milestone 6 measured (91% lines, 80% branches).
      thresholds: { lines: 88, statements: 85, functions: 78, branches: 76 },
    },
  },
});
