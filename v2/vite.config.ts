import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 8792, strictPort: true, host: '127.0.0.1' }, build: { outDir: 'dist' } });
