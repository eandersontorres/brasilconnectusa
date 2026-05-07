import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    rollupOptions: {
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
