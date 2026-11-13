/// <reference types="vitest" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// No proxy and no key in the build: a public world is read keyless from www.onlyworlds.com.
// Two pages from one script: the mapper (index.html) and the same page at signin/callback.html, a
// real file the host serves at /signin/callback, where Sign in with OnlyWorlds returns.
export default defineConfig({
  base: '/',
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4187 },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), callback: resolve(import.meta.dirname, 'signin/callback.html') } },
  },
  test: { include: ['src/**/*.test.ts'] },
});
