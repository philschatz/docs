import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { Repo } from '@automerge/automerge-repo';
import { WebSocketServerAdapter } from '@automerge/automerge-repo-network-websocket';
import { NodeFSStorageAdapter } from '@automerge/automerge-repo-storage-nodefs';
import { WebSocketRelay } from './relay';
import { CalDAVHandler } from './caldav-handler';
import { createUiRoutes } from './routes/ui';
import { createDavRoutes } from './routes/dav';

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000');
const isProd = process.env.NODE_ENV === 'production';
const dataDir = process.env.AUTOMERGE_DATA_DIR || './.data';
fs.mkdirSync(dataDir, { recursive: true });

// WebSocket server — used by both the relay (production) and the test Repo adapter.
const wss = new WebSocketServer({ noServer: true });

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

// In production the server is a pure relay: it forwards messages between peers
// verbatim and never adds its own keyhive signature to a client's changes.
//
// In the test environment we fall back to a plain Repo so Jest can run without
// an ESM keyhive dependency and CalDAV tests still work.
let relay: WebSocketRelay | null = null;

const repoPromise = (async () => {
  const storageAdapter = new NodeFSStorageAdapter(dataDir);

  if (process.env.JEST_WORKER_ID) {
    // Test environment: plain Repo so Jest can sync documents for CalDAV tests.
    const wsAdapter = new WebSocketServerAdapter(wss);
    return new Repo({
      network: [wsAdapter],
      storage: storageAdapter,
      subduction: noopSubduction,
      peerId: 'test-server' as any,
      sharePolicy: async () => true,
    } as any);
  }

  // Production/dev: pure relay — no Repo on the WebSocket path.
  relay = new WebSocketRelay();
  wss.on('connection', (ws) => relay!.handleConnection(ws));
  console.log('[relay] WebSocket relay started (no server-side keyhive signing)');

  // Return a storage-only Repo for CalDAV (no network adapter — documents are
  // populated only when a client explicitly pushes them via the relay).
  return new Repo({
    network: [],
    storage: storageAdapter,
    subduction: noopSubduction,
    peerId: 'caldav-server' as any,
    sharePolicy: async () => false,
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
