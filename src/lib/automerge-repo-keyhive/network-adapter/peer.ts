export class Peer {
  lastKeyhiveRequestRcvd = Date.now();
  lastKeyhiveRequestSent = Date.now();
  // The remote peer's hash count (for our shared peer pair) at the last sync.
  // null before first full sync is completed
  syncpoint: number | null = null;

  // FORK: CGKA encryption — track whether this peer has completed keyhive sync.
  // Until true, doc payloads are NOT encrypted (peer lacks CGKA keys).
  keyhiveSynced = false;
  // FORK: CGKA encryption — when true, next sync request sends full hashes
  // instead of a lightweight sync-check (used after CGKA key rotation).
  forceFullSync = false;
}
