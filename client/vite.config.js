import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/products': { target: 'http://localhost:3000', changeOrigin: true },
      '/orders': { target: 'http://localhost:3000', changeOrigin: true },
      '/login': { target: 'http://localhost:3000', changeOrigin: true },
      '/logout': { target: 'http://localhost:3000', changeOrigin: true },
      '/register': { target: 'http://localhost:3000', changeOrigin: true },
      '/me': { target: 'http://localhost:3000', changeOrigin: true },
    }
  }
})
