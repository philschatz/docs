import { useState, useEffect, useCallback } from 'preact/hooks';
import { getMyAccess, onKeyhiveStateChanged } from './keyhive-api';

export type AccessLevel = 'admin' | 'write' | 'read' | 'pull' | null;

const ACCESS_CACHE_KEY = 'keyhive-access-cache';

function readAccessCache(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(ACCESS_CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function writeAccessCache(khDocId: string, access: AccessLevel): void {
  const cache = readAccessCache();
  if (access === null) delete cache[khDocId];
  else cache[khDocId] = access;
  localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify(cache));
}

export function getCachedAccess(khDocId: string): AccessLevel {
  const cache = readAccessCache();
  return (cache[khDocId] as AccessLevel) ?? null;
}

/**
 * Query the current device's keyhive access level for a document.
 * Returns the access string (admin/write/read/pull) or null if unknown/no keyhive.
 * `canEdit` is true when the access level permits writes (admin or write).
 * `loaded` distinguishes "still fetching" from "confirmed no access".
 * Re-fetches automatically when keyhive state changes (e.g. member added/revoked).
 */
export function useAccess(khDocId: string | undefined): { access: AccessLevel; canEdit: boolean; loaded: boolean } {
  const cached = khDocId ? getCachedAccess(khDocId) : null;
  const [access, setAccess] = useState<AccessLevel>(cached);
  const [loaded, setLoaded] = useState(!!cached);

  const fetchAccess = useCallback(() => {
    if (!khDocId) {
      setAccess(null);
      setLoaded(true);
      return;
    }
    getMyAccess(khDocId).then(a => {
      const level = (a?.toLowerCase() ?? null) as AccessLevel;
      setAccess(level);
      setLoaded(true);
      writeAccessCache(khDocId, level);
    }).catch(() => {
      setAccess(null);
      setLoaded(true);
      writeAccessCache(khDocId, null);
    });
  }, [khDocId]);

  // Initial fetch
  useEffect(() => {
    setLoaded(false);
    fetchAccess();
  }, [fetchAccess]);

  // Re-fetch when keyhive state changes (membership/access updated)
  useEffect(() => {
    if (!khDocId) return;
    return onKeyhiveStateChanged(fetchAccess);
  }, [khDocId, fetchAccess]);

  if (!khDocId) {
    return { access: null, canEdit: true, loaded: true };
  }

  const canEdit = access === 'admin' || access === 'write';
  return { access, canEdit, loaded };
}
