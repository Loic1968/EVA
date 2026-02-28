import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
