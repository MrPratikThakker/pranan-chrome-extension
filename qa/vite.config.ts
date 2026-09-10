import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({ plugins: [react()], resolve: { alias: { '@': resolve(import.meta.dirname, '../src') } }, server: { host: '127.0.0.1', port: 5182 } });
