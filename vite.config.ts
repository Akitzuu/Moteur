import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Chemins relatifs : la page marche sous n'importe quel chemin d'URL.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify('0.8.6') },
  plugins: [react(), tailwindcss()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
})
