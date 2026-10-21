import { defineConfig, loadEnv } from 'vite';

const pagesRoot = '/src/pages%20+%20css%20stylesheet/';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = process.env.PORT || env.PORT || '3003';
  const apiTarget = `http://127.0.0.1:${apiPort}`;
  return {
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
      host: "0.0.0.0",
      port: 3000,
      strictPort: true,
      proxy: {
        '/socket.io': { target: apiTarget, ws: true, changeOrigin: true },
        '/api': {
          target: apiTarget,
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
  };
});
