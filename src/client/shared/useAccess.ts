import { useState, useEffect } from 'preact/hooks';
import { getMyAccess } from './keyhive-api';

export type AccessLevel = 'admin' | 'write' | 'read' | 'pull' | null;

/**
 * Query the current device's keyhive access level for a document.
 * Returns the access string (admin/write/read/pull) or null if unknown/no keyhive.
 * `canEdit` is true when the access level permits writes (admin or write).
 * `loaded` distinguishes "still fetching" from "confirmed no access".
 * When a khDocId exists but access hasn't been confirmed yet, defaults to read-only.
 */
export function useAccess(khDocId: string | undefined): { access: AccessLevel; canEdit: boolean; loaded: boolean } {
  const [access, setAccess] = useState<AccessLevel>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!khDocId) {
      setAccess(null);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    let cancelled = false;
    getMyAccess(khDocId).then(a => {
      const level = (a?.toLowerCase() ?? null) as AccessLevel;
      console.log('[useAccess] khDocId=%s → access=%s canEdit=%s', khDocId, level, level === 'admin' || level === 'write');
      if (!cancelled) { setAccess(level); setLoaded(true); }
    }).catch((err) => {
      console.warn('[useAccess] failed for khDocId=%s:', khDocId, err);
      if (!cancelled) { setAccess(null); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [khDocId]);

  if (!khDocId) {
    return { access: null, canEdit: true, loaded: true };
  }

  const canEdit = access === 'admin' || access === 'write';
  return { access, canEdit, loaded };
}
