import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  const backendTarget =
    process.env.BACKEND_URL ||
    (process.env.npm_lifecycle_event === 'dev:local' ? 'http://localhost:3000' : '');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      ...(backendTarget
        ? {
            proxy: {
              '/api': {
                target: backendTarget,
                changeOrigin: true,
              },
            },
          }
        : {}),
    },
  };
});
