import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createApp } from './server/app.js';
import { createDatabase } from './server/db.js';

function apiPlugin() {
  return {
    name: 'cantina-api',
    configureServer(server) {
      const db = createDatabase();
      const api = createApp({
        db,
        jwtSecret: process.env.JWT_SECRET || 'local-development-secret-change-before-deploy',
        serveFrontend: false,
      });
      server.middlewares.use(api);
      server.httpServer?.once('close', () => db.close());
    },
  };
}

export default defineConfig({
  plugins: [react(), apiPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
