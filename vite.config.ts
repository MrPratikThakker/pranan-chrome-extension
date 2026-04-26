import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { build as viteBuild } from 'vite';

// Content script entry points -- must be bundled as IIFE (no ES module imports)
const contentScriptEntries = {
  'content/gmail': resolve(__dirname, 'src/content/gmail/index.ts'),
  'content/slack': resolve(__dirname, 'src/content/slack/index.ts'),
  'content/linkedin': resolve(__dirname, 'src/content/linkedin/index.ts'),
  'content/universal': resolve(__dirname, 'src/content/universal/index.ts'),
  'content/pranan-app': resolve(__dirname, 'src/content/pranan-app/index.ts'),
};

/**
 * Custom plugin: builds each content script as a standalone IIFE bundle
 * so it works in Chrome's content script sandbox (no ES module support).
 */
function contentScriptPlugin() {
  return {
    name: 'build-content-scripts',
    async closeBundle() {
      for (const [name, entry] of Object.entries(contentScriptEntries)) {
        await viteBuild({
          configFile: false,
          resolve: {
            alias: {
              '@': resolve(__dirname, 'src'),
            },
          },
          build: {
            outDir: 'dist',
            emptyOutDir: false,
            lib: {
              entry,
              name: name.replace(/[\/\-]/g, '_'),
              formats: ['iife'],
              fileName: () => `${name}.js`,
            },
            rollupOptions: {
              output: {
                // Ensure everything is inlined
                inlineDynamicImports: true,
              },
            },
            target: 'esnext',
            minify: 'esbuild',
            sourcemap: false,
          },
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), contentScriptPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'src/background/service-worker.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js';
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false,
  },
  css: {
    postcss: './postcss.config.js',
  },
});
