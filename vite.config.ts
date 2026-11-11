import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  // Rutas relativas (regla 9): el build funciona en cualquier carpeta o portal.
  base: './',
  resolve: {
    // Los complementos de Three.js (cargador de glTF) importan 'three'. Se les da la versión
    // WebGPU, que ya incluye todo el núcleo, para no meter el renderizador WebGL clásico en la descarga.
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    // El límite real lo vigila scripts/check-budget.mjs (15 MB iniciales).
    chunkSizeWarningLimit: 8000,
  },
});
