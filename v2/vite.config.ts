import { defineConfig } from 'vite';
/* The chooser owns the project root. This candidate and its dynamic chunks
 * are served under new/; development still uses the root-based dev server. */
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/iqbattle-shadow-edition/new/' : '/',
  server: { port: 8792, strictPort: true, host: '127.0.0.1' },
  build: { outDir: '../runtime/omarchy/build/new', emptyOutDir: true, target: 'es2022' },
}));
