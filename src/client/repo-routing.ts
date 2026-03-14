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
