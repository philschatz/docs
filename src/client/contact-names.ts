const KEY = 'contact-names';

function loadAll(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function saveAll(names: Record<string, string>): void {
  localStorage.setItem(KEY, JSON.stringify(names));
}

export function getContactName(agentId: string): string | undefined {
  return loadAll()[agentId];
}

export function setContactName(agentId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) {
    removeContactName(agentId);
    return;
  }
  const names = loadAll();
  names[agentId] = trimmed;
  saveAll(names);
}

export function removeContactName(agentId: string): void {
  const names = loadAll();
  delete names[agentId];
  saveAll(names);
}

export function getAllContactNames(): Record<string, string> {
  return loadAll();
}
