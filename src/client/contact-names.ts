// --- Dispatch hook (injected from automerge.ts to avoid circular imports) ---

type ContactNamesDispatch = (type: 'set-contact-name' | 'remove-contact-name', agentId: string, name?: string) => void;
let dispatch: ContactNamesDispatch | null = null;

export function setContactNamesDispatch(fn: ContactNamesDispatch): void {
  dispatch = fn;
}

// --- In-memory cache (populated by worker via applyContactNamesFromWorker) ---

let cache: Record<string, string> = {};

/** Replace the entire cache. Called by automerge.ts on `contact-names-updated`. */
export function applyContactNamesFromWorker(names: Record<string, string>): void {
  cache = { ...names };
}

export function getContactName(agentId: string): string | undefined {
  return cache[agentId];
}

export function setContactName(agentId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) {
    removeContactName(agentId);
    return;
  }
  cache[agentId] = trimmed;
  dispatch?.('set-contact-name', agentId, trimmed);
}

export function removeContactName(agentId: string): void {
  delete cache[agentId];
  dispatch?.('remove-contact-name', agentId);
}
