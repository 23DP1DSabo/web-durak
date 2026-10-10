import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'moved-pages-root',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/') {
            res.statusCode = 302;
            res.setHeader('Location', '/pages%20+%20css%20stylesheet/index.html');
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: 'pages + css stylesheet/index.html',
        room: 'pages + css stylesheet/room.html',
        auth: 'pages + css stylesheet/auth.html',
        friends: 'pages + css stylesheet/friends.html',
        rules: 'pages + css stylesheet/rules.html',
        settings: 'pages + css stylesheet/settings.html',
      },
    },
  },
});