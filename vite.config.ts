/// <reference types="vitest" />
import { defineConfig } from 'vite';

// No proxy and no key in the build: a public world is read keyless from www.onlyworlds.com.
export default defineConfig({
  base: '/',
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4187 },
  build: { outDir: 'dist', sourcemap: false },
  test: { include: ['src/**/*.test.ts'] },
});
