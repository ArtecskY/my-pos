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
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
      '/categories': { target: 'http://localhost:3000', changeOrigin: true },
      '/sheet-config': { target: 'http://localhost:3000', changeOrigin: true },
      '/export-to-sheets': { target: 'http://localhost:3000', changeOrigin: true },
      '/emails': { target: 'http://localhost:3000', changeOrigin: true },
      '/order-items': { target: 'http://localhost:3000', changeOrigin: true },
      '/product-lots': { target: 'http://localhost:3000', changeOrigin: true },
      '/id-pass-dashboard': { target: 'http://localhost:3000', changeOrigin: true },
    }
  }
})
