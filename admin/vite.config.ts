import { defineConfig } from 'vite'
import { getDirname } from '@adonisjs/core/helpers'
import inertia from '@adonisjs/inertia/client'
import react from '@vitejs/plugin-react'
import adonisjs from '@adonisjs/vite/client'
import tailwindcss from '@tailwindcss/vite'


export default defineConfig({
  plugins: [inertia({ ssr: { enabled: false } }), react(), tailwindcss(), adonisjs({ entrypoints: ['inertia/app/app.tsx'], reload: ['resources/views/**/*.edge'] })],

  // The Japa unit suite never serves browser assets. Avoid starting a Vite
  // dependency scan that races with the test runner's shutdown.
  optimizeDeps: process.env.NODE_ENV === 'test' ? { noDiscovery: true } : undefined,

  /**
   * Define aliases for importing modules from
   * your frontend code
   */
  resolve: {
    alias: {
      '~/': `${getDirname(import.meta.url)}/inertia/`,
    },
  },
})
