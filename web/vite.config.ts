import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'maskable-512.png'],
      manifest: {
        name: 'The Sand Gallery',
        short_name: 'Sand Gallery',
        description: 'A gallery of everything you make, with the time it took.',
        theme_color: '#F7F1E8',
        background_color: '#F7F1E8',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // B2 thumbnails/photos: presigned URLs change their query string, so cache by path only.
            urlPattern: ({ url }) => url.hostname.endsWith('backblazeb2.com') && /\/thumbs\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'sg-thumbs',
              expiration: { maxEntries: 800, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
              plugins: [
                {
                  cacheKeyWillBeUsed: async ({ request }) => {
                    const u = new URL(request.url)
                    return u.origin + u.pathname
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5173, host: true },
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0') },
})
