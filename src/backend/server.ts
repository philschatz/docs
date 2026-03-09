import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
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

// Ed25519 signer for server-side Subduction
class NodeSigner {
  #privateKey: crypto.KeyObject;
  #publicKey: crypto.KeyObject;

  constructor() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    this.#privateKey = privateKey;
    this.#publicKey = publicKey;
  }

  sign(message: Uint8Array): Uint8Array {
    const signature = crypto.sign(null, Buffer.from(message), this.#privateKey);
    return new Uint8Array(signature);
  }

  verifyingKey(): Uint8Array {
    const exported = this.#publicKey.export({ type: 'spki', format: 'der' });
    return new Uint8Array(exported.slice(-32));
  }
}

// WebSocket server for automerge-repo sync
const wss = new WebSocketServer({ noServer: true });
const wsAdapter = new WebSocketServerAdapter(wss);

// Initialize Subduction and create automerge-repo
let repoPromise: Promise<InstanceType<typeof Repo>>;

async function initRepo() {
  const storageAdapter = new NodeFSStorageAdapter(dataDir);
  const signer = new NodeSigner();

  const subductionModule = await import('@automerge/automerge-subduction');

  // Inline bridge logic (the bridge package is ESM-only, server compiles to CJS)
  const { setSubductionModule } = await import('@automerge/automerge-repo') as any;
  setSubductionModule(subductionModule);

  // Load and init the storage bridge via the CJS shim approach
  const bridgePath = path.resolve(__dirname, '../../node_modules/@automerge/automerge-repo-subduction-bridge/dist/storage.js');
  const bridgeSrc = fs.readFileSync(bridgePath, 'utf8');
  const bridgeCjs = bridgeSrc
    .replace(/import\s*\{[^}]*\}\s*from\s*["'][^"']*["'];?\s*/g, '')
    .replace(/export function /g, 'function ')
    .replace(/export class /g, 'class ');
  const bridgeFn = new Function('module', 'exports', 'require', bridgeCjs + '\nmodule.exports = { SubductionStorageBridge, _setSubductionModuleForStorage };');
  const bridgeMod: any = { exports: {} };
  bridgeFn(bridgeMod, bridgeMod.exports, require);
  bridgeMod.exports._setSubductionModuleForStorage(subductionModule);

  const storage = new bridgeMod.exports.SubductionStorageBridge(storageAdapter);
  const subduction = await subductionModule.Subduction.hydrate(signer, storage);

  return new Repo({
    network: [wsAdapter],
    subduction,
    peerId: `calendar-server-${os.hostname()}` as any,
    sharePolicy: async () => true,
  } as any);
}

repoPromise = initRepo();

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
