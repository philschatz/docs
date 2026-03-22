/**
 * Repo routing for dual-repo worker: maps document IDs to secure/insecure repos.
 */

export type RepoMode = 'secure' | 'insecure';

/** Tracks which docId belongs to which repo. */
const docRepoMap = new Map<string, RepoMode>();

/** Populate the map from a doc list (called at worker init). */
export function populateDocRepoMap(docList: Array<{ id: string; encrypted?: boolean }>) {
  for (const entry of docList) {
    docRepoMap.set(entry.id, entry.encrypted ? 'secure' : 'insecure');
  }
}

/** Record a doc's repo assignment. */
export function setDocRepo(docId: string, mode: RepoMode) {
  docRepoMap.set(docId, mode);
}

/** Get a doc's repo assignment, or undefined if unknown. */
export function getDocRepo(docId: string): RepoMode | undefined {
  return docRepoMap.get(docId);
}

/** Clear all mappings (for testing). */
export function clearDocRepoMap() {
  docRepoMap.clear();
}

/**
 * Pick the correct repo for a given docId.
 * Falls back to insecureRepo if available, then secureRepo.
 */
export function repoFor<T>(
  docId: string,
  secureRepo: T | null,
  insecureRepo: T | null,
): T {
  const mode = docRepoMap.get(docId);
  if (mode === 'secure' && secureRepo) return secureRepo;
  if (mode === 'insecure' && insecureRepo) return insecureRepo;
  // Fallback: prefer insecure (always available), then secure
  if (insecureRepo) return insecureRepo;
  if (secureRepo) return secureRepo;
  throw new Error('No repo available');
}

interface RepoLike {
  find(docId: any): Promise<{ whenReady(): Promise<void> }> | { whenReady(): Promise<void> };
}

/**
 * When the repo for a docId is unknown, try both repos and return the handle
 * from whichever becomes ready first. Records the winning repo in docRepoMap.
 *
 * This handles the case where a user opens a shared secure document URL
 * before keyhive has synced — the doc isn't in the local doc list yet, and
 * keyhive detection returns null. Without this, repoFor() defaults to
 * insecure, the handle never becomes ready, and the user gets stuck.
 */
export async function findInRepos(
  docId: string,
  secureRepo: RepoLike | null,
  insecureRepo: RepoLike | null,
): Promise<{ handle: any; mode: RepoMode }> {
  const candidates: Array<{ repo: RepoLike; mode: RepoMode }> = [];
  if (secureRepo) candidates.push({ repo: secureRepo, mode: 'secure' });
  if (insecureRepo) candidates.push({ repo: insecureRepo, mode: 'insecure' });
  if (candidates.length === 0) throw new Error('No repo available');
  if (candidates.length === 1) {
    const { repo, mode } = candidates[0];
    const handle = await repo.find(docId as any);
    setDocRepo(docId, mode);
    return { handle, mode };
  }
  // Race both repos — first to become ready wins
  const entries = await Promise.all(
    candidates.map(async ({ repo, mode }) => ({
      handle: await repo.find(docId as any),
      mode,
    })),
  );
  const winner = await Promise.race(
    entries.map(({ handle, mode }) =>
      handle.whenReady().then(() => ({ handle, mode })),
    ),
  );
  setDocRepo(docId, winner.mode);
  return winner;
}
