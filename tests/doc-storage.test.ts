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

import { getDocList, addDocId, removeDocId, updateDocCache, touchDoc } from '../src/client/doc-storage';

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

  it('migrates legacy string array format', () => {
    store[STORAGE_KEY] = JSON.stringify(['id-a', 'id-b']);
    const result = getDocList();
    expect(result).toEqual([{ id: 'id-a' }, { id: 'id-b' }]);
    expect(JSON.parse(store[STORAGE_KEY])).toEqual([{ id: 'id-a' }, { id: 'id-b' }]);
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

describe('touchDoc', () => {
  it('moves doc to front', () => {
    addDocId('doc-1');
    addDocId('doc-2');
    addDocId('doc-3');
    touchDoc('doc-1');
    expect(getDocList().map(e => e.id)).toEqual(['doc-1', 'doc-3', 'doc-2']);
  });

  it('does nothing if doc is already first', () => {
    addDocId('doc-1');
    addDocId('doc-2');
    touchDoc('doc-2');
    expect(getDocList().map(e => e.id)).toEqual(['doc-2', 'doc-1']);
  });

  it('does nothing for non-existent doc', () => {
    addDocId('doc-1');
    touchDoc('doc-999');
    expect(getDocList().map(e => e.id)).toEqual(['doc-1']);
  });
});
