/**
 * Tests for doc-storage.ts localStorage helpers.
 * Corner cases: array→object migration, add/remove/update operations.
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

import { getDocMap, addDocId, removeDocId, updateDocCache } from '../src/client/doc-storage';

beforeEach(() => {
  store = {};
});

describe('getDocMap', () => {
  it('returns empty object when nothing stored', () => {
    expect(getDocMap()).toEqual({});
  });

  it('returns object map when stored as object', () => {
    store[STORAGE_KEY] = JSON.stringify({ 'doc-1': { type: 'Calendar', name: 'Work' }, 'doc-2': {} });
    expect(getDocMap()).toEqual({ 'doc-1': { type: 'Calendar', name: 'Work' }, 'doc-2': {} });
  });

  it('migrates legacy array format to object map', () => {
    store[STORAGE_KEY] = JSON.stringify(['id-a', 'id-b']);
    const result = getDocMap();
    expect(result).toEqual({ 'id-a': {}, 'id-b': {} });
    // Should also persist the migrated format
    expect(JSON.parse(store[STORAGE_KEY])).toEqual({ 'id-a': {}, 'id-b': {} });
  });

  it('returns empty object for invalid JSON', () => {
    store[STORAGE_KEY] = 'not-json!!!';
    expect(getDocMap()).toEqual({});
  });

  it('returns empty object for empty array', () => {
    store[STORAGE_KEY] = JSON.stringify([]);
    const result = getDocMap();
    expect(result).toEqual({});
  });
});

describe('addDocId', () => {
  it('adds a new doc with cache', () => {
    addDocId('doc-1', { type: 'Calendar', name: 'Work' });
    expect(getDocMap()).toEqual({ 'doc-1': { type: 'Calendar', name: 'Work' } });
  });

  it('adds a new doc without cache', () => {
    addDocId('doc-1');
    expect(getDocMap()).toEqual({ 'doc-1': {} });
  });

  it('preserves existing cache when adding without cache', () => {
    addDocId('doc-1', { type: 'Calendar', name: 'Work' });
    addDocId('doc-1');
    expect(getDocMap()).toEqual({ 'doc-1': { type: 'Calendar', name: 'Work' } });
  });

  it('overwrites cache when provided', () => {
    addDocId('doc-1', { type: 'Calendar' });
    addDocId('doc-1', { type: 'DataGrid', name: 'Sheet' });
    expect(getDocMap()).toEqual({ 'doc-1': { type: 'DataGrid', name: 'Sheet' } });
  });
});

describe('removeDocId', () => {
  it('removes an existing doc', () => {
    addDocId('doc-1');
    addDocId('doc-2');
    removeDocId('doc-1');
    expect(getDocMap()).toEqual({ 'doc-2': {} });
  });

  it('does nothing when removing non-existent doc', () => {
    addDocId('doc-1');
    removeDocId('doc-999');
    expect(getDocMap()).toEqual({ 'doc-1': {} });
  });
});

describe('updateDocCache', () => {
  it('merges cache for existing doc', () => {
    addDocId('doc-1', { type: 'Calendar' });
    updateDocCache('doc-1', { name: 'Updated' });
    expect(getDocMap()).toEqual({ 'doc-1': { type: 'Calendar', name: 'Updated' } });
  });

  it('does nothing for non-existent doc', () => {
    addDocId('doc-1');
    updateDocCache('doc-999', { name: 'Ghost' });
    expect(getDocMap()).toEqual({ 'doc-1': {} });
  });
});
