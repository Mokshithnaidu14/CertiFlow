import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser only talks to this server; /api is forwarded to the Express API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', changeOrigin: true },
    },
  },
});
