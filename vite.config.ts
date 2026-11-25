/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// MediaPipe's WASM runtime is served from /mediapipe/wasm in both dev and build so the
// FilesetResolver path is identical everywhere.
export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@mediapipe/tasks-vision/wasm/*',
          dest: 'mediapipe/wasm',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  worker: { format: 'es' },
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin' } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
