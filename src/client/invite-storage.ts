import { idbGet, idbSet } from './idb-storage';

export interface InviteRecord {
  id: string;
  khDocId: string;
  inviteUrl: string;
  role: string;
  createdAt: number;
  inviteSignerAgentId: string;
  /** agentIds of members BEFORE this invite was generated */
  baselineAgentIds: string[];
}

const IDB_KEY = 'automerge-invites';
const LS_KEY = 'automerge-invites';

let migrated = false;

/** Lazy migration: on first IDB read, pull any existing localStorage records into IDB. */
async function loadAll(): Promise<InviteRecord[]> {
  let records = await idbGet<InviteRecord[]>(IDB_KEY);
  if (!migrated) {
    migrated = true;
    if (!records || records.length === 0) {
      // Migrate from localStorage
      try {
        const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
        if (Array.isArray(raw) && raw.length > 0) {
          records = raw;
          await idbSet(IDB_KEY, records);
          localStorage.removeItem(LS_KEY);
        }
      } catch { /* ignore */ }
    } else {
      // Already in IDB — clear localStorage copy if present
      localStorage.removeItem(LS_KEY);
    }
  }
  return Array.isArray(records) ? records : [];
}

async function saveAll(records: InviteRecord[]): Promise<void> {
  await idbSet(IDB_KEY, records);
}

export async function getInviteRecords(khDocId: string): Promise<InviteRecord[]> {
  const all = await loadAll();
  return all.filter(r => r.khDocId === khDocId);
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

export async function removeInviteRecordsForDoc(khDocId: string): Promise<void> {
  const all = await loadAll();
  await saveAll(all.filter(r => r.khDocId !== khDocId));
}
