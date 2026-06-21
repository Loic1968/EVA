import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
      manifest: false,
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 3001,
    host: true, // Expose to network (iPhone: http://YOUR_MAC_IP:3001)
    proxy: {
      '/api': {
        target: 'http://localhost:5002',
        changeOrigin: true,
        timeout: 0,
      },
    },
  },
});
