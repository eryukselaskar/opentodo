/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Libraries change rarely; a separate chunk stays cached between app updates
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@radix-ui') || id.includes('lucide-react')) return 'ui-vendor';
          return 'vendor';
        },
      },
    },
  },
  test: {
    // Component tests opt into jsdom with a `@vitest-environment jsdom` comment
    setupFiles: ['./src/test/setup.ts'],
  },
  server: {
    proxy: {
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ollama/, ''),
      },
    },
  },
});
