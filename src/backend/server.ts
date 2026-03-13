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
import { createAdminRoutes } from './routes/admin';
import { initCaldavKeyhive, type CaldavKeyhive } from './caldav-keyhive';

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

// In production the server is a keyhive-enabled repo client that connects to
// its own relay via localhost WebSocket. This lets CalDAV read encrypted docs.
//
// In the test environment we fall back to a plain Repo so Jest can run without
// an ESM keyhive dependency and CalDAV tests still work.
let relay: WebSocketRelay | null = null;
let caldavKeyhive: CaldavKeyhive | null = null;

// Resolves to the Repo for CalDAV. In test mode this resolves immediately;
// in prod/dev it resolves after the keyhive repo connects to the relay.
let resolveRepo: (repo: Repo) => void;
const repoPromise = new Promise<Repo>((resolve) => { resolveRepo = resolve; });

if (process.env.JEST_WORKER_ID) {
  // Test environment: plain Repo so Jest can sync documents for CalDAV tests.
  const storageAdapter = new NodeFSStorageAdapter(dataDir);
  const wsAdapter = new WebSocketServerAdapter(wss);
  resolveRepo!(new Repo({
    network: [wsAdapter],
    storage: storageAdapter,
    subduction: noopSubduction,
    peerId: 'test-server' as any,
    sharePolicy: async () => true,
  } as any));
} else {
  // Production/dev: pure relay for peer-to-peer forwarding.
  relay = new WebSocketRelay();
  wss.on('connection', (ws) => relay!.handleConnection(ws));
  console.log('[relay] WebSocket relay started');
}

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

  // Vite middleware first — serves JS/CSS/assets before UI catch-all routes
  if (vite) {
    app.use(vite.middlewares);
  } else if (isProd && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
  }

  // Mount routes
  app.use(createUiRoutes(vite, isProd ? distDir : null));
  app.use(createAdminRoutes(() => caldavKeyhive));
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
    // In prod/dev, routes don't need the repo to mount — only CalDAV handlers
    // await it lazily. Start the HTTP server first so the relay is listening.
    const server = app.listen(PORT, '0.0.0.0', async () => {
      const mode = isProd ? 'production' : 'development';
      console.log(`Automerge Docs (${mode}): http://localhost:${PORT}`);
      if (isProd) console.log('Serving production build');

      // Now the relay is listening — initialize the keyhive repo.
      try {
        const khDataDir = path.join(dataDir, 'caldav-keyhive');
        fs.mkdirSync(khDataDir, { recursive: true });
        caldavKeyhive = await initCaldavKeyhive(khDataDir, `ws://localhost:${PORT}`);
        resolveRepo!(caldavKeyhive.repo);
        console.log('[caldav-keyhive] repo ready');
      } catch (err) {
        console.error('[caldav-keyhive] failed to initialize:', err);
        // Fall back to storage-only repo so CalDAV still works for non-encrypted docs
        const storageAdapter = new NodeFSStorageAdapter(dataDir);
        resolveRepo!(new Repo({
          network: [],
          storage: storageAdapter,
          subduction: noopSubduction,
          peerId: 'caldav-server' as any,
          sharePolicy: async () => false,
        } as any));
      }
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
