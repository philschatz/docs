/**
 * Tests for document persistence across refresh with noop subduction.
 *
 * Three bugs combine to break persistence:
 * 1. Repo.create() registers the save listener AFTER handle.update(), missing the initial save
 * 2. The noop getBlobs returns [] so the Repo never loads from storage on refresh
 * 3. toDocumentId() truncates 32-byte keyhive IDs to 16 bytes, producing wrong storage keys
 *
 * The fixes:
 * 1. Explicit storageSubsystem.saveDoc() after create
 * 2. getBlobs reads from storageSubsystem.loadDocData(loadingDocId)
 * 3. loadingDocId is set by getOrLoadHandle before calling repo.find(), avoiding toDocumentId()
 */

const { Repo } = require('@automerge/automerge-repo');
const Automerge = require('@automerge/automerge');

// --- Helpers ---

type StorageKey = string[];

function inMemoryStorage() {
  const store = new Map<string, Uint8Array>();
  const key = (k: StorageKey) => k.join('\x00');
  return {
    store,
    async load(k: StorageKey) { return store.get(key(k)); },
    async save(k: StorageKey, data: Uint8Array) { store.set(key(k), data); },
    async remove(k: StorageKey) { store.delete(key(k)); },
    async loadRange(prefix: StorageKey) {
      const p = prefix.join('\x00');
      const out: { key: StorageKey; data: Uint8Array }[] = [];
      for (const [k, v] of store) {
        if (k === p || k.startsWith(p + '\x00')) out.push({ key: k.split('\x00'), data: v });
      }
      return out;
    },
    async removeRange(prefix: StorageKey) {
      const p = prefix.join('\x00');
      for (const k of store.keys()) if (k === p || k.startsWith(p + '\x00')) store.delete(k);
    },
  };
}

/**
 * Noop subduction. If loadingDocIdRef is provided, getBlobs reads from the
 * repo's storageSubsystem using that docId (mirrors automerge-worker.ts).
 */
function makeSubduction(opts?: { repoRef: { current: any }; loadingDocIdRef: { current: string | null } }) {
  return {
    storage: {},
    removeSedimentree() {},
    connectDiscover() {},
    disconnectAll() {},
    disconnectFromPeer() {},
    syncAll() { return Promise.resolve({ entries() { return []; } }); },
    syncWithAllPeers() { return Promise.resolve(new Map()); },
    async getBlobs(_sedimentreeId: any) {
      if (!opts) return [];
      const { repoRef, loadingDocIdRef } = opts;
      const docId = loadingDocIdRef.current;
      if (!docId || !repoRef.current?.storageSubsystem) return [];
      const data: Uint8Array | null = await repoRef.current.storageSubsystem.loadDocData(docId);
      return data ? [data] : [];
    },
    addCommit() { return Promise.resolve(undefined); },
    addFragment() { return Promise.resolve(undefined); },
  };
}

const initialDoc = { '@type': 'Calendar', name: 'Test', events: {} };

const repos: any[] = [];
afterAll(async () => { for (const r of repos) try { await r.shutdown(); } catch {} });

function makeRepo(storage: any, sub: any, peerId: string) {
  const r = new Repo({ storage, subduction: sub, peerId: peerId as any } as any);
  repos.push(r);
  return r;
}

// --- Tests ---

describe('document persistence with noop subduction', () => {
  it('Repo.create() does not persist initial doc (save listener registered too late)', async () => {
    const repo = makeRepo(inMemoryStorage(), makeSubduction(), 'test-1');
    const handle = repo.create(initialDoc);
    await new Promise(r => setTimeout(r, 200));
    expect(await repo.storageSubsystem!.loadDocData(handle.documentId)).toBeNull();
  });

  it('edits after create ARE persisted (save listener is registered by then)', async () => {
    const repo = makeRepo(inMemoryStorage(), makeSubduction(), 'test-2');
    const handle = repo.create(initialDoc);
    handle.change((d: any) => { d.name = 'Edited'; });
    await new Promise(r => setTimeout(r, 200));
    expect(await repo.storageSubsystem!.loadDocData(handle.documentId)).not.toBeNull();
  });

  it('explicit saveDoc after create fixes the initial persistence gap', async () => {
    const repo = makeRepo(inMemoryStorage(), makeSubduction(), 'test-3');
    const handle = repo.create(initialDoc);
    await repo.storageSubsystem!.saveDoc(handle.documentId, handle.doc());
    expect(await repo.storageSubsystem!.loadDocData(handle.documentId)).not.toBeNull();
  });

  it('getBlobs backed by loadingDocId loads saved data on reload', async () => {
    const storage = inMemoryStorage();
    const repoRef: { current: any } = { current: null };
    const loadingDocIdRef: { current: string | null } = { current: null };
    const repo = makeRepo(storage, makeSubduction({ repoRef, loadingDocIdRef }), 'test-4');
    repoRef.current = repo;

    const handle = repo.create(initialDoc);
    const docId = handle.documentId;
    await repo.storageSubsystem!.saveDoc(docId, handle.doc());

    // Simulate getOrLoadHandle setting loadingDocId before repo.find()
    loadingDocIdRef.current = docId;
    const sub = makeSubduction({ repoRef, loadingDocIdRef });
    const blobs = await sub.getBlobs(null);
    loadingDocIdRef.current = null;

    expect(blobs.length).toBe(1);
    const doc = Automerge.loadIncremental(Automerge.init(), blobs[0]);
    expect((doc as any)['@type']).toBe('Calendar');
  });

  it('cross-session: new Repo loads data saved by previous Repo', async () => {
    const storage = inMemoryStorage();

    // Session 1: create + edit + save
    const repo1 = makeRepo(storage, makeSubduction(), 'session-1');
    const handle = repo1.create(initialDoc);
    handle.change((d: any) => { d.name = 'Edited by Alice'; });
    const docId = handle.documentId;
    await repo1.storageSubsystem!.saveDoc(docId, handle.doc());
    await new Promise(r => setTimeout(r, 200));
    await repo1.shutdown();

    // Session 2: verify data is loadable via the fixed getBlobs pattern
    const repoRef: { current: any } = { current: null };
    const loadingDocIdRef: { current: string | null } = { current: docId };
    const repo2 = new Repo({
      storage,
      subduction: makeSubduction({ repoRef, loadingDocIdRef }),
      peerId: 'session-2' as any,
    } as any);
    repos.push(repo2);
    repoRef.current = repo2;

    const blobs = await makeSubduction({ repoRef, loadingDocIdRef }).getBlobs(null);
    expect(blobs.length).toBe(1);
    const doc = Automerge.loadIncremental(Automerge.init(), blobs[0]);
    expect((doc as any).name).toBe('Edited by Alice');
  });
});
