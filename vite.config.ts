import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Keep the existing public manifest and icons as the single source of truth.
      manifest: false,
      registerType: 'autoUpdate',
      workbox: {
        // Only generated static assets are precached; no API/runtime caching is configured.
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
