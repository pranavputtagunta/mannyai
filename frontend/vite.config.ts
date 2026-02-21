import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Any request starting with /onshape-proxy gets intercepted
      '/onshape-proxy': {
        target: 'https://cad.onshape.com',
        changeOrigin: true, // This is the magic line that spoofs the CORS header
        rewrite: (path) => path.replace(/^\/onshape-proxy/, ''),
      },
    },
  },
});