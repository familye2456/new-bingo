import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'icons/*.svg'],
      manifest: {
        name: 'Fidel Bingo',
        short_name: 'FidelBingo',
        description: 'Fidel Bingo - Play offline',
        theme_color: '#0e1a35',
        background_color: '#0e1a35',
        display: 'standalone',
        start_url: '/dashboard',
        scope: '/dashboard',
        icons: [
          { src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Cache the app shell (JS/CSS/HTML) and all sounds
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,mp3,wav}'],
        // Runtime caching for user API routes only (not admin)
        runtimeCaching: [
          {
            // User profile, cartelas, game history, transactions
            urlPattern: /^https?:\/\/.*\/api\/(users\/me|cartelas\/mine|games\/mine|users\/me\/transactions|games\/[^/?]+$)/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'user-api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 }, // 7 days
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Game list
            urlPattern: /^https?:\/\/.*\/api\/games(\?.*)?$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'games-list-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 10 }, // 10 min
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Never cache admin routes
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/admin/],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
