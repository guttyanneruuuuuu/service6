import { defineConfig } from 'vite';

// GitHub Pages deploy base path. Repo name: service6
// When served from https://<user>.github.io/service6/ the base must match.
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          peer: ['peerjs'],
        },
      },
    },
  },
});
