import { defineConfig } from 'vite';

const pagesRoot = '/src/pages%20+%20css%20stylesheet/';

export default defineConfig({
  plugins: [
    {
      name: 'moved-pages-root',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/') {
            res.statusCode = 302;
            res.setHeader('Location', `${pagesRoot}index.html`);
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
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      }
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: 'src/pages + css stylesheet/index.html',
        room: 'src/pages + css stylesheet/room.html',
        gameTable: 'src/pages + css stylesheet/game-table.html',
        auth: 'src/pages + css stylesheet/auth.html',
        friends: 'src/pages + css stylesheet/friends.html',
        rules: 'src/pages + css stylesheet/rules.html',
        settings: 'src/pages + css stylesheet/settings.html',
      },
    },
  },
});