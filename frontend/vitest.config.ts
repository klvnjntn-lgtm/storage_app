import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests for the frontend's pure logic (lib/**/*.test.ts). Pages and
// components are exercised end to end, not here.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: { include: ['lib/**/*.test.ts'], environment: 'node' },
});
