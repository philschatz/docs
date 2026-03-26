import { idbGet, idbSet } from './idb-storage';

export interface InviteRecord {
  id: string;
  docId: string;
  inviteUrl: string;
  role: string;
  createdAt: number;
  inviteSignerAgentId: string;
  /** agentIds of members BEFORE this invite was generated */
  baselineAgentIds: string[];
}

const IDB_KEY = 'automerge-invites';

async function loadAll(): Promise<InviteRecord[]> {
  const records = await idbGet<InviteRecord[]>(IDB_KEY);
  return Array.isArray(records) ? records : [];
}

async function saveAll(records: InviteRecord[]): Promise<void> {
  await idbSet(IDB_KEY, records);
}

export async function getInviteRecords(docId: string): Promise<InviteRecord[]> {
  const all = await loadAll();
  return all.filter(r => r.docId === docId);
}

export async function addInviteRecord(record: InviteRecord): Promise<void> {
  const all = await loadAll();
  all.push(record);
  await saveAll(all);
}

export async function removeInviteRecord(id: string): Promise<void> {
  const all = await loadAll();
  await saveAll(all.filter(r => r.id !== id));
}

export async function getAllInviteRecords(): Promise<InviteRecord[]> {
  return loadAll();
}

export async function removeInviteRecordsForDoc(docId: string): Promise<void> {
  const all = await loadAll();
  await saveAll(all.filter(r => r.docId !== docId));
}

export async function pruneInvitesNotIn(knownDocIds: Set<string>): Promise<void> {
  const all = await loadAll();
  const filtered = all.filter(r => knownDocIds.has(r.docId));
  if (filtered.length < all.length) await saveAll(filtered);
}
