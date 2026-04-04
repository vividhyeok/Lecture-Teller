import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/v2/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/audio': 'http://localhost:8000',
    },
  },
  build: {
    outDir: '../static-v2',
    emptyOutDir: true,
  },
})
