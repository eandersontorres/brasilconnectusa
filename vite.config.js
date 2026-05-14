import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    rollupOptions: {
      // app.html é o entry da SPA (servido em /app via vercel.json rewrite).
      // A landing estática mora em public/index.html — Vite copia direto pro
      // dist/ sem processar, e o Vercel serve no `/`.
      input: resolve(__dirname, 'app.html'),
      output: {
        manualChunks: {
          // React + ReactDOM em chunk separado (cacheável entre deploys)
          'react-vendor': ['react', 'react-dom'],
          // Supabase client em chunk próprio (só carrega quando precisa)
          'supabase': ['@supabase/supabase-js'],
        },
      },
    },
    chunkSizeWarningLimit: 400,
  },
})
