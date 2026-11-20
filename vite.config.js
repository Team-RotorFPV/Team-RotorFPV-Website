import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // A production build without VITE_API_URL used to fall back to
  // http://localhost:3000 silently, so the live site called the visitor's own
  // machine and every form and admin action failed. Fail the build instead.
  if (command === 'build') {
    const apiUrl = loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL
    if (!apiUrl) {
      throw new Error('VITE_API_URL is not set. Set it to the backend URL (e.g. the Render service) before building.')
    }
    if (mode === 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(apiUrl)) {
      console.warn(`\n⚠  Building for production with VITE_API_URL=${apiUrl}. Fine for a local preview; never deploy this build.\n`)
    }
  }

  return {
    plugins: [react()],
  }
})
