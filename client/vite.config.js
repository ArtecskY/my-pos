import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKEND = 'http://localhost:3000'
const p = target => ({ target, changeOrigin: true })

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/products':          p(BACKEND),
      '/orders':            p(BACKEND),
      '/order-items':       p(BACKEND),
      '/categories':        p(BACKEND),
      '/emails':            p(BACKEND),
      '/email-types':       p(BACKEND),
      '/email-summary':     p(BACKEND),
      '/email-topups':      p(BACKEND),
      '/product-lots':      p(BACKEND),
      '/users':             p(BACKEND),
      '/reservations':      p(BACKEND),
      '/razer-accounts':    p(BACKEND),
      '/razer-account-types': p(BACKEND),
      '/bot-status':        p(BACKEND),
      '/bot-kill':          p(BACKEND),
      '/bot-screenshots':   p(BACKEND),
      '/admin':             p(BACKEND),
      '/login':             p(BACKEND),
      '/logout':            p(BACKEND),
      '/register':          p(BACKEND),
      '/me':                p(BACKEND),
      '/uploads':           p(BACKEND),
      '/sheet-config':      p(BACKEND),
      '/export-to-sheets':  p(BACKEND),
      '/id-pass-dashboard': p(BACKEND),
      '/health':            p(BACKEND),
    }
  }
})
