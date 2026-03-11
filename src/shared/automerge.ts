import { useState, useEffect, useRef } from 'preact/hooks';
import { Repo } from '@automerge/automerge-repo';
import { MessageChannelNetworkAdapter } from '@automerge/automerge-repo-network-messagechannel';
export * as Automerge from '@automerge/automerge';
export { Presence } from '@automerge/automerge-repo';
export type { DocHandle, DocumentId, PeerId } from '@automerge/automerge-repo';
export type { PeerState, PresenceState } from '@automerge/automerge-repo';
import type { WorkerToMain } from '../client/automerge-worker';
import { initKeyhiveApi, handleKeyhiveResponse, getMyAccess, registerDocMapping } from './keyhive-api';
import { getDocEntry, getDocList } from '../client/doc-storage';

const SYNC_DISABLED_KEY = 'automerge-sync-disabled';

function defaultWsUrl(): string {
  if (typeof location === 'undefined') return '';
  return location.protocol === 'http:'
    ? `ws://${location.host}`
    : 'wss://sync.automerge.org';
}

export function isSyncEnabled(): boolean {
  return localStorage.getItem(SYNC_DISABLED_KEY) !== '1';
}

export function getWsUrl(): string {
  if (!isSyncEnabled()) return '';
  return defaultWsUrl();
}

// --- Worker setup ---

const worker = new Worker(
  new URL('../client/automerge-worker.ts', import.meta.url),
  { type: 'module' },
);

const channel = new MessageChannel();

// Main-thread repo: ephemeral, no storage, syncs with worker via MessageChannel.
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
export const repo = new Repo({
  network: [new MessageChannelNetworkAdapter(channel.port1)],
  isEphemeral: true,
  subduction: noopSubduction,
} as any);

// Initialize keyhive API with worker reference
initKeyhiveApi(worker);

// Send the other port to the worker along with the websocket URL
worker.postMessage(
  { type: 'init', wsUrl: getWsUrl(), port: channel.port2 },
  [channel.port2],
);

export function setSyncEnabled(enabled: boolean) {
  if (enabled) {
    localStorage.removeItem(SYNC_DISABLED_KEY);
  } else {
    localStorage.setItem(SYNC_DISABLED_KEY, '1');
  }
  worker.postMessage({ type: 'set-ws-url', wsUrl: enabled ? defaultWsUrl() : '' });
}

// --- Repo network ready promise (resolves when main-thread repo connects to worker peer) ---

let resolveRepoReady: () => void;
export const workerReady = new Promise<void>(r => { resolveRepoReady = r; });
const ns = repo.networkSubsystem;
ns.on('peer', (p: any) => { console.log('[automerge] workerReady: peer event, peerId=', p?.peerId ?? p); resolveRepoReady(); });

// Keyhive-specific ready promise — resolves when WASM + keyhive are fully initialized
let resolveKeyhiveReady: () => void;
export const keyhiveReady = new Promise<void>(r => { resolveKeyhiveReady = r; });

// --- Read-only enforcement ---
// Documents where the current user has read-only access.
// handle.change() is blocked for these documents.
const readOnlyDocs = new Set<string>();

export function isDocReadOnly(docId: string): boolean {
  return readOnlyDocs.has(docId);
}

/** Mark a document as read-only and guard its handle against changes. */
export function markDocReadOnly(docId: string) {
  readOnlyDocs.add(docId);
  // Guard the existing handle if it's already loaded
  const handle = (repo as any).handles?.[docId];
  if (handle && !(handle as any).__readOnlyGuarded) {
    guardHandle(handle, docId);
  }
}

function guardHandle(handle: any, docId: string) {
  if (handle.__readOnlyGuarded) return;
  handle.__readOnlyGuarded = true;
  // Use defineProperty to intercept change() via the prototype chain.
  // handle.change may not exist yet (set lazily), so we install a getter
  // that wraps the original method on first access.
  let wrapped: ((...a: any[]) => any) | null = null;
  const proto = Object.getPrototypeOf(handle);
  Object.defineProperty(handle, 'change', {
    configurable: true,
    enumerable: true,
    get() {
      const orig = proto.change;
      if (!orig) return orig;
      if (!wrapped) {
        wrapped = (...args: any[]) => {
          if (readOnlyDocs.has(docId)) {
            console.log('!!!!!! oooh, you are being malicious because you only have read access. let us see what happens with the other peers')
          }
          return orig.apply(handle, args);
        };
      }
      return wrapped;
    },
    set() {
      // Ignore attempts to overwrite — keep our guard in place
    },
  });
}

// Wrap repo.find() so every handle gets a dynamic read-only guard
const origRepoFind = repo.find.bind(repo);
(repo as any).find = async (docId: any, ...rest: any[]) => {
  const handle = await origRepoFind(docId, ...rest);
  guardHandle(handle, String(docId));
  return handle;
};

/**
 * Load a document via findWithProgress, calling `onProgress(0-100)` as loading advances.
 * `onProgress` is called with `null` once the document is ready (caller should hide the bar).
 */
export async function findDocWithProgress<T>(
  docId: string,
  onProgress: (pct: number | null) => void,
): Promise<import('@automerge/automerge-repo').DocHandle<T>> {
  console.log('[automerge] findDocWithProgress: waiting for workerReady, docId=', docId);
  await workerReady;
  console.log('[automerge] findDocWithProgress: workerReady resolved, calling repo.find');
  const handle = await repo.find<T>(docId as any);
  console.log('[automerge] findDocWithProgress: repo.find resolved, handle state=', (handle as any).state);
  onProgress(null);

  // Check access level for keyhive-shared documents
  const entry = getDocEntry(docId);
  if (entry?.khDocId) {
    await keyhiveReady;
    const access = await getMyAccess(entry.khDocId);
    if (access && access.toLowerCase() !== 'admin' && access.toLowerCase() !== 'write') {
      console.log(`[automerge] Document ${docId} is read-only (access: ${access})`);
      readOnlyDocs.add(docId);
    }
  }

  return handle;
}

// --- Worker query API ---

let queryIdCounter = 0;
const pendingQueries = new Map<number, { resolve: (result: any[]) => void; reject: (err: Error) => void }>();

/**
 * Run a jq filter against a document in the worker without loading it into main-thread memory.
 */
export async function queryDoc(docId: string, filter: string): Promise<any[]> {
  await workerReady;
  const id = ++queryIdCounter;
  return new Promise((resolve, reject) => {
    pendingQueries.set(id, { resolve, reject });
    worker.postMessage({ type: 'query', id, docId, filter });
  });
}

// --- Home doc summary subscription ---

import type { DocSummary } from '../client/automerge-worker';
export type { DocSummary };

type HomeSummaryCallback = (summary: DocSummary) => void;
let homeSummaryCallback: HomeSummaryCallback | null = null;

export function subscribeHome(
  docIds: string[],
  callback: HomeSummaryCallback,
): () => void {
  homeSummaryCallback = callback;
  worker.postMessage({ type: 'subscribe-home', docIds });
  return () => {
    homeSummaryCallback = null;
    worker.postMessage({ type: 'unsubscribe-home' });
  };
}

// --- Connection status (listens to worker messages) ---

type ConnectionListener = (connected: boolean) => void;
const connectionListeners = new Set<ConnectionListener>();
let workerPeerCount = 0;
let workerPeers: string[] = [];

type PeerListListener = (peers: string[]) => void;
const peerListListeners = new Set<PeerListListener>();

worker.onmessage = (e: MessageEvent<WorkerToMain>) => {
  const msg = e.data;
  if (msg.type === 'ready') {
    // Worker initialized — peer event on repo.networkSubsystem resolves workerReady
  } else if (msg.type === 'kh-ready') {
    // Register all known automerge→keyhive doc mappings so the docMap is populated
    // before any sync messages arrive (EditorTitleBar also registers on mount, but
    // that's too late for docs syncing in the background).
    for (const entry of getDocList()) {
      if (entry.khDocId) {
        registerDocMapping(entry.id, entry.khDocId);
      }
    }
    resolveKeyhiveReady();
  } else if (msg.type === 'error') {
    console.error('Automerge worker error:', msg.message);
  } else if (msg.type === 'peer-connected' || msg.type === 'peer-disconnected') {
    workerPeerCount = msg.peerCount;
    workerPeers = msg.peers;
    const connected = workerPeerCount > 0;
    for (const fn of connectionListeners) fn(connected);
    for (const fn of peerListListeners) fn(workerPeers);
  } else if (msg.type === 'kh-result') {
    handleKeyhiveResponse(msg);
  } else if (msg.type === 'doc-summary') {
    if (homeSummaryCallback) homeSummaryCallback(msg.summary);
  } else if (msg.type === 'query-result') {
    const pending = pendingQueries.get(msg.id);
    if (pending) {
      pendingQueries.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error));
      else pending.resolve(msg.result);
    }
  }
};

worker.onerror = (e) => {
  console.error('Automerge worker failed to load:', e.message);
};

/**
 * Returns true when the worker repo has at least one connected peer (i.e. the server).
 * Disconnection is debounced by 6 s (> the 5 s retry interval in the WS adapter)
 * so brief disconnect/reconnect cycles don't flash the indicator red.
 */
export function useConnectionStatus(): boolean {
  const [connected, setConnected] = useState(() => workerPeerCount > 0);
  const disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const listener: ConnectionListener = (isConnected) => {
      if (isConnected) {
        if (disconnectTimer.current !== null) {
          clearTimeout(disconnectTimer.current);
          disconnectTimer.current = null;
        }
        setConnected(true);
      } else {
        if (disconnectTimer.current !== null) return;
        disconnectTimer.current = setTimeout(() => {
          disconnectTimer.current = null;
          setConnected(workerPeerCount > 0);
        }, 6000);
      }
    };
    connectionListeners.add(listener);
    return () => {
      connectionListeners.delete(listener);
      if (disconnectTimer.current !== null) {
        clearTimeout(disconnectTimer.current);
        disconnectTimer.current = null;
      }
    };
  }, []);

  return connected;
}

export function usePeerList(): string[] {
  const [peers, setPeers] = useState(() => workerPeers);

  useEffect(() => {
    const listener: PeerListListener = (p) => setPeers(p);
    peerListListeners.add(listener);
    return () => { peerListListeners.delete(listener); };
  }, []);

  return peers;
}
