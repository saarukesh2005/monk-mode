import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) => fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

// Tauri expects a fixed dev port and serves the built assets from dist/.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@monk/shared-types': pkg('shared-types'),
      '@monk/shared-core': pkg('shared-core'),
      '@monk/analytics': pkg('analytics'),
      '@monk/validation': pkg('validation'),
      '@monk/design-system': pkg('design-system'),
    },
  },
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2021',
    minify: 'esbuild',
    sourcemap: false,
    outDir: 'dist',
  },
});
