import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        auth: 'auth.html',
        friends: 'friends.html',
        rules: 'rules.html',
        settings: 'settings.html',
      },
    },
  },
});