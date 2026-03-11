import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const EXTENSION_STATIC_FILES = ['manifest.json', 'background.js', 'content.js', 'style.css'];

function copyExtensionStaticFiles(): Plugin {
  return {
    name: 'copy-extension-static-files',
    apply: 'build',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      mkdirSync(outDir, { recursive: true });

      for (const file of EXTENSION_STATIC_FILES) {
        copyFileSync(resolve(__dirname, file), resolve(outDir, file));
      }
    }
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionStaticFiles()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html')
      }
    }
  }
});
