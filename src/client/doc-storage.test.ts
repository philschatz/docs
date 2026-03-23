/**
 * Tests for doc-storage.ts localStorage helpers.
 */

const STORAGE_KEY = 'automerge-doc-ids';

// Mock localStorage
let store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { store = {}; },
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

import { getDocList, addDocId, removeDocId, updateDocCache, applyDocListFromWorker, onDocListUpdated, setDocListDispatch } from './doc-storage';

beforeEach(() => {
  store = {};
});

describe('getDocList', () => {
  it('returns empty array when nothing stored', () => {
    expect(getDocList()).toEqual([]);
  });

  it('returns entries when stored as array of objects', () => {
    store[STORAGE_KEY] = JSON.stringify([{ id: 'doc-1', type: 'Calendar', name: 'Work' }, { id: 'doc-2' }]);
    expect(getDocList()).toEqual([{ id: 'doc-1', type: 'Calendar', name: 'Work' }, { id: 'doc-2' }]);
  });

  it('returns empty array for invalid JSON', () => {
    store[STORAGE_KEY] = 'not-json!!!';
    expect(getDocList()).toEqual([]);
  });

  it('returns empty array for non-array value', () => {
    store[STORAGE_KEY] = JSON.stringify({ 'doc-1': {} });
    expect(getDocList()).toEqual([]);
  });
});

describe('addDocId', () => {
  it('adds a new doc at the front', () => {
    addDocId('doc-1', { type: 'Calendar', name: 'Work' });
    expect(getDocList()).toEqual([{ id: 'doc-1', type: 'Calendar', name: 'Work' }]);
  });

  it('adds new docs at the front', () => {
    addDocId('doc-1');
    addDocId('doc-2');
    expect(getDocList().map(e => e.id)).toEqual(['doc-2', 'doc-1']);
  });

  it('moves existing doc to front when re-added', () => {
    addDocId('doc-1');
    addDocId('doc-2');
    addDocId('doc-1', { type: 'Calendar' });
    expect(getDocList()).toEqual([{ id: 'doc-1', type: 'Calendar' }, { id: 'doc-2' }]);
  });

  it('preserves existing cache when adding without cache', () => {
    addDocId('doc-1', { type: 'Calendar', name: 'Work' });
    addDocId('doc-1');
    expect(getDocList()).toEqual([{ id: 'doc-1', type: 'Calendar', name: 'Work' }]);
  });

  it('stores type, encrypted, and khDocId from invite claim', () => {
    addDocId('inv-1', { encrypted: true, khDocId: 'kh-1', type: 'Calendar' as any });
    const entry = getDocList().find(e => e.id === 'inv-1');
    expect(entry?.type).toBe('Calendar');
    expect(entry?.encrypted).toBe(true);
    expect(entry?.khDocId).toBe('kh-1');
  });
});

describe('removeDocId', () => {
  it('removes an existing doc', () => {
    addDocId('doc-1');
    addDocId('doc-2');
    removeDocId('doc-1');
    expect(getDocList()).toEqual([{ id: 'doc-2' }]);
  });

  it('does nothing when removing non-existent doc', () => {
    addDocId('doc-1');
    removeDocId('doc-999');
    expect(getDocList()).toEqual([{ id: 'doc-1' }]);
  });
});

describe('updateDocCache', () => {
  it('merges cache for existing doc', () => {
    addDocId('doc-1', { type: 'Calendar' });
    updateDocCache('doc-1', { name: 'Updated' });
    expect(getDocList()).toEqual([{ id: 'doc-1', type: 'Calendar', name: 'Updated' }]);
  });

  it('does nothing for non-existent doc', () => {
    addDocId('doc-1');
    updateDocCache('doc-999', { name: 'Ghost' });
    expect(getDocList()).toEqual([{ id: 'doc-1' }]);
  });
});

describe('applyDocListFromWorker', () => {
  it('writes list to localStorage and notifies listeners', () => {
    const listener = jest.fn();
    const unsub = onDocListUpdated(listener);
    const list = [{ id: 'doc-a', type: 'Calendar' as const, name: 'Work' }];
    applyDocListFromWorker(list);
    expect(getDocList()).toEqual(list);
    expect(listener).toHaveBeenCalledWith(list);
    unsub();
  });

  it('unsubscribe stops notifications', () => {
    const listener = jest.fn();
    const unsub = onDocListUpdated(listener);
    unsub();
    applyDocListFromWorker([{ id: 'doc-b' }]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('dispatch message shape', () => {
  afterEach(() => {
    setDocListDispatch(null as any);
  });

  it('addDocId dispatches message type and metadata separately', () => {
    const messages: Array<{ msgType: string; docId: string; metadata: any }> = [];
    setDocListDispatch((msgType, docId, metadata) => {
      messages.push({ msgType, docId, metadata });
    });

    addDocId('doc-1', { type: 'Calendar', name: 'Work', encrypted: true, khDocId: 'kh-1' });

    expect(messages).toHaveLength(1);
    expect(messages[0].msgType).toBe('add-doc-to-list');
    expect(messages[0].docId).toBe('doc-1');
    expect(messages[0].metadata).toEqual({ type: 'Calendar', name: 'Work', encrypted: true, khDocId: 'kh-1' });
  });

  it('metadata.type does not collide with message type when building worker message', () => {
    // Simulates what automerge.ts does: builds a postMessage payload from dispatch args.
    // The old bug: { type: msgType, docId, ...metadata } would let metadata.type overwrite msgType.
    const posted: any[] = [];
    setDocListDispatch((msgType, docId, metadata) => {
      // Current (fixed) pattern: metadata is nested
      posted.push({ type: msgType, docId, metadata });
    });

    addDocId('doc-1', { type: 'Calendar', name: 'Test' });

    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('add-doc-to-list');
    expect(posted[0].metadata?.type).toBe('Calendar');
  });

  it('removeDocId dispatches without metadata', () => {
    const messages: Array<{ msgType: string; docId: string; metadata: any }> = [];
    setDocListDispatch((msgType, docId, metadata) => {
      messages.push({ msgType, docId, metadata });
    });

    addDocId('doc-1');
    removeDocId('doc-1');

    expect(messages).toHaveLength(2);
    expect(messages[1].msgType).toBe('remove-doc-from-list');
    expect(messages[1].docId).toBe('doc-1');
  });

  it('encrypted and khDocId are preserved in metadata for worker init re-registration', () => {
    // After refresh, the worker reads IDB entries and re-registers keyhive doc
    // mappings using encrypted + khDocId. This test verifies these fields survive
    // the dispatch so the worker can store them in IDB.
    const posted: any[] = [];
    setDocListDispatch((msgType, docId, metadata) => {
      posted.push({ type: msgType, docId, metadata });
    });

    addDocId('secure-doc', { type: 'Calendar', name: 'Work', encrypted: true, khDocId: 'kh-abc123' });

    expect(posted).toHaveLength(1);
    const msg = posted[0];
    // Worker handler reads msg.metadata to store in IDB
    expect(msg.metadata.encrypted).toBe(true);
    expect(msg.metadata.khDocId).toBe('kh-abc123');
    // Simulating what the worker does: extract metadata and store in IDB list
    const idbEntry = { id: msg.docId, ...msg.metadata };
    expect(idbEntry).toEqual({
      id: 'secure-doc',
      type: 'Calendar',
      name: 'Work',
      encrypted: true,
      khDocId: 'kh-abc123',
    });
  });

  it('simulated IDB round-trip preserves all metadata needed for reload', () => {
    // When the worker stores metadata to IDB and reloads on refresh, all fields
    // must survive. This is critical because:
    // - encrypted → determines repo routing (secure vs insecure)
    // - khDocId → needed to re-register keyhive doc mapping for decryption
    // - type/name → shown on homepage before doc subscription resolves
    const posted: any[] = [];
    setDocListDispatch((msgType, docId, metadata) => {
      posted.push({ type: msgType, docId, metadata });
    });

    addDocId('doc-1', { type: 'TaskList', name: 'Tasks', encrypted: false });
    addDocId('doc-2', { type: 'Calendar', name: 'Work', encrypted: true, khDocId: 'kh-xyz' });

    // Simulate what the worker does: store to IDB, then reload on refresh
    const idbList = posted.map(msg => ({ id: msg.docId, ...msg.metadata }));

    // Simulate refresh: worker sends IDB list back, client applies it
    applyDocListFromWorker(idbList);
    const reloaded = getDocList();

    expect(reloaded).toHaveLength(2);
    expect(reloaded[0]).toEqual({ id: 'doc-1', type: 'TaskList', name: 'Tasks', encrypted: false });
    expect(reloaded[1]).toEqual({ id: 'doc-2', type: 'Calendar', name: 'Work', encrypted: true, khDocId: 'kh-xyz' });
  });
});
