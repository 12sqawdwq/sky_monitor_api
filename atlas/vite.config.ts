import { defineConfig } from 'vite';

// Production is the home page of https://sky.eunoia.top, same origin as the
// sky backend. In dev the backend (no CORS headers) is reached through this
// proxy; point VITE_SKY_API_BASE elsewhere to bypass it.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.ATLAS_BASE || '/' : '/',
  server: {
    proxy: {
      '/sky-api': {
        target: process.env.SKY_API_TARGET || 'https://sky.eunoia.top',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/sky-api/, '')
      },
      // Backend pages linked from the Services menu.
      '^/(wiki|docs|redoc|health|openapi\\.json)': {
        target: process.env.SKY_API_TARGET || 'https://sky.eunoia.top',
        changeOrigin: true
      }
    }
  }
}));
