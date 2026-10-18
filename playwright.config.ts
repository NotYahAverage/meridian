import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  // Scratch specs used while developing; run with E2E_TMP=1.
  testIgnore: process.env.E2E_TMP ? [] : ['tmp/**'],
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: {
      // Use the real GPU when available (falls back to SwiftShader otherwise).
      // UNCAPPED=1 lifts the display's frame-rate cap, to measure how fast frames can really go.
      args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', ...(process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])],
    },
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
