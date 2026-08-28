import { defineConfig } from 'vite';
/* base is conditional: dev stays at / (http://localhost:8792/), but the
 * production bundle is built for the GitHub Pages project page URL
 * https://<user>.github.io/iqbattle-shadow-edition/, so assets get that prefix.
 * `command === 'build'` is the documented Vite pattern for this. */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/iqbattle-shadow-edition/' : '/',
  server: { port: 8792, strictPort: true, host: '127.0.0.1' },
  build: { outDir: 'dist', target: 'es2022' },
}));
