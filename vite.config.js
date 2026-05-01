import { defineConfig } from 'vite';

// GitHub Pages: https://guttyanneruuuuuu.github.io/service6/
// dev/preview では '/' のままだと相対パス問題が出るため、本番のみ '/service6/' を base にする
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/service6/' : '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
        },
      },
    },
  },
}));
