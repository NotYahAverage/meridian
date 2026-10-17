/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// `base: './'` keeps every asset URL relative so the production build can be
// loaded straight from disk (file://) when the game is wrapped in Electron.
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: false,
    // Generated output: watching it wastes work, and on Windows the watcher's
    // directory handles stop electron-builder from renaming its output folder.
    watch: { ignored: ['**/desktop/release/**', '**/desktop/node_modules/**', '**/bench/.out/**', '**/e2e/screenshots/**', '**/test-results/**', '**/dist/**'] },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Three.js changes rarely; a separate chunk stays cached across game updates
        // and downloads in parallel with the game code.
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Some tests generate full terrain and round-trip saves; give them room on busy machines.
    // Generating the full-size world and saving/loading it takes a few seconds per city.
    testTimeout: 120_000,
    // Shared test towns are built in beforeAll hooks, alongside long traffic runs in other files.
    hookTimeout: 120_000,
  },
});
