import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: process.env.VITE_TRANSPORT === 'webrtc' ? 'dist' : '../WhitePad.Server/wwwroot',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/hub': {
        target: 'https://localhost:5001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
});
