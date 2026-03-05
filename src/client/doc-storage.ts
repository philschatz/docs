type DocType = 'Calendar' | 'TaskList' | 'DataGrid' | 'unknown';

interface DocCache {
  type?: DocType;
  name?: string;
}

type DocMap = Record<string, DocCache>;

const DOC_STORAGE_KEY = 'automerge-doc-ids';

export function getDocMap(): DocMap {
  try {
    const raw = JSON.parse(localStorage.getItem(DOC_STORAGE_KEY) || '{}');
    if (Array.isArray(raw)) {
      const map: DocMap = {};
      for (const id of raw) map[id] = {};
      localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify(map));
      return map;
    }
    return raw;
  } catch { return {}; }
}

function saveDocMap(map: DocMap) {
  localStorage.setItem(DOC_STORAGE_KEY, JSON.stringify(map));
}

export function addDocId(id: string, cache?: DocCache) {
  const map = getDocMap();
  map[id] = cache || map[id] || {};
  saveDocMap(map);
}

export function removeDocId(id: string) {
  const map = getDocMap();
  delete map[id];
  saveDocMap(map);
}

export function updateDocCache(id: string, cache: DocCache) {
  const map = getDocMap();
  if (!(id in map)) return;
  map[id] = { ...map[id], ...cache };
  saveDocMap(map);
}
