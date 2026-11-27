const { defineConfig } = require('vite');

module.exports = defineConfig({
  publicDir: 'public',
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost'] },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost'] },
  build: { outDir: 'dist', emptyOutDir: true }
});
