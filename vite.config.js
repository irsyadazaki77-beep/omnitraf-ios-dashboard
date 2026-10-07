import { defineConfig } from 'vite';

const backend = process.env.OMNITRAF_BACKEND_ORIGIN || 'http://localhost:3000';

export default defineConfig({
  publicDir: 'public',
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/socket.io': { target: backend, ws: true, changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: true,
    cssMinify: 'esbuild',
    sourcemap: false,
    manifest: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  }
});
