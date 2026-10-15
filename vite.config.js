import { defineConfig } from 'vite';

const backend = process.env.OMNITRAF_BACKEND_ORIGIN || 'http://localhost:3000';
const viteHost = process.env.OMNITRAF_VITE_LAN === 'true' ? '0.0.0.0' : '127.0.0.1';
const backendProxy = {
  '/api': { target: backend, changeOrigin: true },
  '/socket.io': { target: backend, ws: true, changeOrigin: true }
};

export default defineConfig({
  publicDir: 'public',
  server: {
    host: viteHost,
    port: 5173,
    proxy: backendProxy
  },
  preview: {
    host: viteHost,
    port: 4173,
    proxy: backendProxy
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
        assetFileNames: 'assets/[name]-[hash][extname]',
        codeSplitting: {
          groups: [{ name: 'three-vendor', test: /[\\/]node_modules[\\/]three[\\/]/, maxSize: 450 * 1024 }]
        }
      }
    }
  }
});
