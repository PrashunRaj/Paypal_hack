import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1600 },
  server: {
    port: 5173,
    proxy: { '/api': API, '/uploads': API },
  },
});
