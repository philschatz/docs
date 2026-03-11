import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WebSocketServer } from 'ws';
import { Repo } from '@automerge/automerge-repo';
import { WebSocketServerAdapter } from '@automerge/automerge-repo-network-websocket';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import { CalDAVHandler } from './caldav-handler';
import { createUiRoutes } from './routes/ui';
import { createDavRoutes } from './routes/dav';

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000');
const isProd = process.env.NODE_ENV === 'production';
const dataDir = process.env.AUTOMERGE_DATA_DIR || './.data';
fs.mkdirSync(dataDir, { recursive: true });

// WebSocket server for automerge-repo sync
const wss = new WebSocketServer({ noServer: true });
const wsAdapter = new WebSocketServerAdapter(wss);

// Plain automerge-repo: stores documents and relays sync messages between peers.
// Keyhive signing/auth is handled client-side by the KeyhiveNetworkAdapter.
// The subduction-tagged automerge-repo requires a subduction instance — provide a no-op stub.
const noopSubduction = {
  storage: {},
  removeSedimentree() {},
  connectDiscover() {},
  disconnectAll() {},
  disconnectFromPeer() {},
  syncAll() { return Promise.resolve({ entries() { return []; } }); },
  getBlobs() { return Promise.resolve([]); },
  addCommit() { return Promise.resolve(undefined); },
  addFragment() { return Promise.resolve(undefined); },
};
const repoPromise = (async () => {
  const storageAdapter = new NodeFSStorageAdapter(dataDir);
  return new Repo({
    network: [wsAdapter],
    storage: storageAdapter,
    subduction: noopSubduction,
    peerId: `drive-server-${os.hostname()}` as any,
    sharePolicy: async () => true,
  } as any);
})();

// Body parsers
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.text({ type: ['text/calendar', 'text/plain', 'application/xml'] }));

// Initialize Vite, then mount routes
export const ready = (async () => {
  const repo = await repoPromise;
  const caldavHandler = new CalDAVHandler(repo);

  // Create Vite dev server or serve production build
  let vite: any = null;
  const distDir = path.resolve(__dirname, '../../dist');

  if (!process.env.JEST_WORKER_ID && !isProd) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      server: { middlewareMode: true, hmr: { port: PORT + 1 } },
      appType: 'custom',
    });
  }

  // Request logging
  app.use((req: Request, res: Response, next) => {
    const { method, url } = req;
    process.stdout.write(`→ ${method} ${url}\n`);
    next();
  });

  // Vite middleware first — serves JS/CSS/assets before UI catch-all routes
  if (vite) {
    app.use(vite.middlewares);
  } else if (isProd && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
  }

  // Mount routes
  app.use(createUiRoutes(vite, isProd ? distDir : null));
  app.use(createDavRoutes(caldavHandler));

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, next: any) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
  });

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found', message: `Route ${req.method} ${req.path} not found` });
  });
})();

// Start server (not in test environment)
if (!process.env.JEST_WORKER_ID) {
  (async () => {
    await ready;

    const server = app.listen(PORT, '0.0.0.0', () => {
      const mode = isProd ? 'production' : 'development';
      console.log(`Automerge Docs (${mode}): http://localhost:${PORT}`);
      if (isProd) console.log('Serving production build');
    });

    // Route WebSocket upgrades to the automerge-repo adapter
    server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });

    // Graceful shutdown
    const shutdown = () => {
      wss.close();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  })();
}

export default app;
