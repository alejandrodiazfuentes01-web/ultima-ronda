import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  // Rutas relativas (regla 9): el build funciona en cualquier carpeta o portal.
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    // El límite real lo vigila scripts/check-budget.mjs (15 MB iniciales).
    chunkSizeWarningLimit: 8000,
  },
});
