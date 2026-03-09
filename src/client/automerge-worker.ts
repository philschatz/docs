export type DocSummary = {
  docId: string;
  type: string;
  name: string;
  count: number;
  lastModified: string | null;
  peers: string[];
};

export type MainToWorker =
  | { type: 'init'; wsUrl: string; port: MessagePort }
  | { type: 'set-ws-url'; wsUrl: string }
  | { type: 'query'; id: number; docId: string; filter: string }
  | { type: 'subscribe-home'; docIds: string[] }
  | { type: 'unsubscribe-home' };

export type WorkerToMain =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'peer-connected'; peerCount: number; peers: string[] }
  | { type: 'peer-disconnected'; peerCount: number; peers: string[] }
  | { type: 'query-result'; id: number; result: any[]; error?: string }
  | { type: 'doc-summary'; summary: DocSummary };

// Queue messages that arrive while WASM is initializing
const pendingMessages: MessageEvent[] = [];
self.onmessage = (e: MessageEvent) => { pendingMessages.push(e); };

// Dynamic import so the queue handler above is registered BEFORE WASM top-level await runs
let Repo: any, IndexedDBStorageAdapter: any, MessageChannelNetworkAdapter: any, Automerge: any;
let BrowserWebSocketClientAdapter: any;
let subductionModule: any, WebCryptoSigner: any, setupSubduction: any;
try {
  ({ Repo } = await import('@automerge/automerge-repo'));
  ({ IndexedDBStorageAdapter } = await import('@automerge/automerge-repo-storage-indexeddb'));
  ({ MessageChannelNetworkAdapter } = await import('@automerge/automerge-repo-network-messagechannel'));
  ({ BrowserWebSocketClientAdapter } = await import('@automerge/automerge-repo-network-websocket'));
  Automerge = await import('@automerge/automerge');
  subductionModule = await import('@automerge/automerge-subduction');
  WebCryptoSigner = subductionModule.WebCryptoSigner;
  ({ setupSubduction } = await import('@automerge/automerge-repo-subduction-bridge'));
} catch (err: any) {
  console.error('[worker] Failed to load modules:', err);
  (self as any).postMessage({ type: 'error', message: `Module load failed: ${err?.message || err}` });
  throw err;
}

let repo: InstanceType<typeof Repo> | null = null;
let subduction: any = null;
let mcPeerId: string | null = null;
let wsAdapter: any = null;

function postStatus() {
  // Count only non-MessageChannel peers (i.e. WebSocket server connections)
  const peers = repo ? repo.peers.filter(id => id !== mcPeerId) : [];
  const peerCount = peers.length;
  (self as any).postMessage({ type: peerCount > 0 ? 'peer-connected' : 'peer-disconnected', peerCount, peers } satisfies WorkerToMain);
}

function setupWebSocket(wsUrl: string) {
  if (!wsUrl || !repo) return;
  // Remove old adapter if reconnecting
  if (wsAdapter) {
    wsAdapter.disconnect();
  }
  wsAdapter = new BrowserWebSocketClientAdapter(wsUrl);
  repo.networkSubsystem.addNetworkAdapter(wsAdapter);
}

// --- Home subscription: push doc summaries on change ---

let homeCleanups: (() => void)[] = [];

function docSummary(docId: string, doc: any, peerIds: string[]): DocSummary {
  const type = doc?.['@type'] || 'unknown';
  const name = doc?.name || '';
  let count = 0;
  if (type === 'Calendar') {
    count = doc?.events ? Object.keys(doc.events).length : 0;
  } else if (type === 'TaskList') {
    count = doc?.tasks ? Object.keys(doc.tasks).length : 0;
  } else if (type === 'DataGrid') {
    if (doc?.sheets) {
      for (const k of Object.keys(doc.sheets)) {
        const sheet = doc.sheets[k];
        if (sheet?.cells) count += Object.keys(sheet.cells).length;
      }
    } else if (doc?.cells) {
      count = Object.keys(doc.cells).length;
    }
  }
  let lastModified: string | null = null;
  try {
    const meta = Automerge.getChangesMetaSince(doc, []);
    let maxTime = 0;
    for (const m of meta) {
      if (m.time > maxTime) maxTime = m.time;
    }
    if (maxTime > 0) {
      lastModified = new Date(maxTime * 1000).toISOString();
    }
  } catch { /* fall back to null */ }
  return { docId, type, name, count, lastModified, peers: peerIds };
}

function cleanupHome() {
  for (const fn of homeCleanups) fn();
  homeCleanups = [];
}

async function setupHomeSubscription(docIds: string[]) {
  cleanupHome();
  if (!repo) return;

  const { Presence } = await import('@automerge/automerge-repo');

  for (const docId of docIds) {
    let handle = repo.handles[docId as any] as any;
    if (!handle) {
      // Document not loaded yet — try to find it with a timeout
      try {
        handle = await Promise.race([
          repo.find(docId as any),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
      } catch {
        continue;
      }
    }
    if (!handle?.doc?.()) continue;

    // Presence for this doc
    const presence = new Presence({ handle });
    presence.start({ initialState: { viewing: true }, heartbeatMs: 5000, peerTtlMs: 15000 });

    const getPeerIds = (): string[] => {
      const states = presence.getPeerStates().value;
      return Object.entries(states)
        .filter(([, s]: [string, any]) => s?.value?.viewing)
        .map(([peerId]) => peerId);
    };

    const sendSummary = () => {
      const doc = handle.doc();
      if (!doc) return;
      (self as any).postMessage({ type: 'doc-summary', summary: docSummary(docId, doc, getPeerIds()) } satisfies WorkerToMain);
    };

    // Send initial summary
    sendSummary();

    // Listen for doc changes
    const onChange = () => sendSummary();
    handle.on('change', onChange);

    // Listen for presence changes
    presence.on('update', sendSummary);
    presence.on('goodbye', sendSummary);
    presence.on('snapshot', sendSummary);

    homeCleanups.push(() => {
      handle.off('change', onChange);
      presence.stop();
    });
  }
}

// ---

async function handleMessage(e: MessageEvent<MainToWorker>) {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      const mcAdapter = new MessageChannelNetworkAdapter(msg.port);
      const signer = await WebCryptoSigner.setup();
      const storageAdapter = new IndexedDBStorageAdapter();

      const result = await setupSubduction({
        subductionModule,
        signer,
        storageAdapter,
      });
      subduction = result.subduction;

      // Create repo with Subduction for encrypted sync
      repo = new Repo({
        network: [],
        subduction,
      } as any);

      const ns = repo.networkSubsystem;
      ns.on('peer', postStatus);
      ns.on('peer-disconnected', postStatus);

      // Track the MessageChannel peer so postStatus can exclude it
      ns.on('peer', (p: any) => {
        if (!mcPeerId) mcPeerId = p?.peerId ?? p;
      });
      repo.networkSubsystem.addNetworkAdapter(mcAdapter);

      (self as any).postMessage({ type: 'ready' } satisfies WorkerToMain);

      // Connect to server via WebSocket
      if (msg.wsUrl) {
        setupWebSocket(msg.wsUrl);
      }
    } catch (err: any) {
      (self as any).postMessage({ type: 'error', message: err?.message || 'Worker init failed' } satisfies WorkerToMain);
    }
  }

  if (msg.type === 'set-ws-url') {
    setupWebSocket(msg.wsUrl);
  }

  if (msg.type === 'subscribe-home') {
    await setupHomeSubscription(msg.docIds);
  }

  if (msg.type === 'unsubscribe-home') {
    cleanupHome();
  }

  if (msg.type === 'query') {
    try {
      if (!repo) throw new Error('Repo not initialized');
      const { compile } = await import('../shared/jq');
      const handle = repo.handles[msg.docId as any] as any;
      if (!handle) {
        const h = repo.find(msg.docId as any);
        const ready = await Promise.race([
          h.then((h: any) => h.doc() ? h : null),
          new Promise(r => setTimeout(() => r(null), 3000)),
        ]) as any;
        if (!ready?.doc()) {
          (self as any).postMessage({ type: 'query-result', id: msg.id, result: [], error: 'Document not found' } satisfies WorkerToMain);
          return;
        }
        const fn = compile(msg.filter);
        const result = fn(ready.doc());
        (self as any).postMessage({ type: 'query-result', id: msg.id, result } satisfies WorkerToMain);
        return;
      }
      const doc = handle.doc();
      if (!doc) {
        (self as any).postMessage({ type: 'query-result', id: msg.id, result: [], error: 'Document not ready' } satisfies WorkerToMain);
        return;
      }
      const fn = compile(msg.filter);
      const result = fn(doc);
      (self as any).postMessage({ type: 'query-result', id: msg.id, result } satisfies WorkerToMain);
    } catch (err: any) {
      console.error('[worker] query failed for', msg.docId, err);
      (self as any).postMessage({ type: 'query-result', id: msg.id, result: [], error: err?.message || 'Query failed' } satisfies WorkerToMain);
    }
  }
}

// Replace queue handler with real handler and drain
self.onmessage = handleMessage;
for (const msg of pendingMessages) handleMessage(msg);
pendingMessages.length = 0;
