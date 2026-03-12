/**
 * Tests for keyhive invite & key exchange infrastructure.
 *
 * Covers: PromiseQueue, Pending, peer ID utilities, invite payload
 * encoding/decoding, WASM signing & verification, and the full
 * invite generate → claim round-trip.
 */

import { Pending, PromiseQueue } from '../src/lib/automerge-repo-keyhive/network-adapter/pending';
import { peerIdFromVerifyingKey } from '../src/lib/automerge-repo-keyhive/network-adapter/messages';
import {
  isKeyhivePeerId,
  verifyingKeyPeerIdWithoutSuffix,
  uint8ArrayToHex,
  hexToUint8Array,
  peerIdFromSigner,
} from '../src/lib/automerge-repo-keyhive/utilities';
import { initKeyhiveWasm } from '../src/lib/automerge-repo-keyhive';
import type { PeerId } from '@automerge/automerge-repo/slim';

// WASM imports — available after initKeyhiveWasm()
import {
  Signer,
  Keyhive,
  CiphertextStore,
  Access,
  Archive,
  ChangeId,
} from '@keyhive/keyhive/slim';
import {
  signData,
  verifyData,
  decodeKeyhiveMessageData,
} from '../src/lib/automerge-repo-keyhive/network-adapter/messages';

beforeAll(() => {
  initKeyhiveWasm();
});

// ── PromiseQueue ────────────────────────────────────────────────────────────

describe('PromiseQueue', () => {
  it('runs tasks sequentially', async () => {
    const q = new PromiseQueue();
    const order: number[] = [];

    const p1 = q.run(async () => {
      await delay(30);
      order.push(1);
    });
    const p2 = q.run(async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('propagates return values', async () => {
    const q = new PromiseQueue();
    const result = await q.run(async () => 42);
    expect(result).toBe(42);
  });

  it('continues after a rejected task', async () => {
    const q = new PromiseQueue();

    const p1 = q.run(async () => { throw new Error('boom'); });
    await expect(p1).rejects.toThrow('boom');

    const result = await q.run(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('fire-and-forget does not deadlock with subsequent await', async () => {
    const q = new PromiseQueue();
    const order: string[] = [];

    // Simulate the pattern from receiveMessage: outer queue task fires inner
    await q.run(async () => {
      order.push('outer-start');
      // Fire-and-forget inner task (queues after outer finishes)
      void q.run(async () => { order.push('inner'); });
      order.push('outer-end');
    });

    // Inner task should now be queued — run a follow-up to flush it
    await q.run(async () => { order.push('follow-up'); });

    expect(order).toEqual(['outer-start', 'outer-end', 'inner', 'follow-up']);
  });
});

// ── Pending ─────────────────────────────────────────────────────────────────

describe('Pending', () => {
  it('fires in-order callbacks immediately', () => {
    const p = new Pending();
    const results: number[] = [];

    const s1 = p.register();
    const s2 = p.register();
    p.fire(s1, () => results.push(1));
    p.fire(s2, () => results.push(2));

    expect(results).toEqual([1, 2]);
  });

  it('buffers out-of-order then drains when gap fills', () => {
    const p = new Pending();
    const results: number[] = [];

    const s1 = p.register();
    const s2 = p.register();
    const s3 = p.register();

    // Fire 3 and 2 before 1
    p.fire(s3, () => results.push(3));
    p.fire(s2, () => results.push(2));
    expect(results).toEqual([]);

    // Fire 1 — should drain all
    p.fire(s1, () => results.push(1));
    expect(results).toEqual([1, 2, 3]);
  });

  it('cancel unblocks subsequent entries', () => {
    const p = new Pending();
    const results: number[] = [];

    const s1 = p.register();
    const s2 = p.register();
    const s3 = p.register();

    p.fire(s3, () => results.push(3));
    p.cancel(s1);
    // s1 cancelled, s2 is now the gap
    p.fire(s2, () => results.push(2));

    expect(results).toEqual([2, 3]);
  });
});

// ── Peer ID utilities ───────────────────────────────────────────────────────

describe('peer ID utilities', () => {
  const key32 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key32[i] = i;

  describe('peerIdFromVerifyingKey', () => {
    it('returns base64 for a 32-byte key', () => {
      const peerId = peerIdFromVerifyingKey(key32);
      // Decode and verify round-trip
      const decoded = Uint8Array.from(atob(peerId), c => c.charCodeAt(0));
      expect(decoded).toEqual(key32);
    });

    it('appends suffix with dash', () => {
      const peerId = peerIdFromVerifyingKey(key32, 'ws');
      expect(peerId).toMatch(/-ws$/);
    });

    it('no dash when suffix is empty', () => {
      const peerId = peerIdFromVerifyingKey(key32, '');
      expect(peerId).not.toContain('-');
    });
  });

  describe('isKeyhivePeerId', () => {
    it('returns true for a valid 32-byte key peer ID', () => {
      const peerId = peerIdFromVerifyingKey(key32);
      expect(isKeyhivePeerId(peerId)).toBe(true);
    });

    it('returns true with suffix', () => {
      const peerId = peerIdFromVerifyingKey(key32, 'suffix');
      expect(isKeyhivePeerId(peerId)).toBe(true);
    });

    it('returns false for short key', () => {
      const short = btoa(String.fromCharCode(...new Uint8Array(16)));
      expect(isKeyhivePeerId(short as PeerId)).toBe(false);
    });

    it('returns false for non-base64', () => {
      expect(isKeyhivePeerId('not-valid-base64!!!' as PeerId)).toBe(false);
    });
  });

  describe('verifyingKeyPeerIdWithoutSuffix', () => {
    it('strips suffix', () => {
      expect(verifyingKeyPeerIdWithoutSuffix('abc-ws' as PeerId)).toBe('abc');
    });

    it('returns identity when no suffix', () => {
      expect(verifyingKeyPeerIdWithoutSuffix('abc' as PeerId)).toBe('abc');
    });
  });

  describe('hex conversion', () => {
    it('round-trips', () => {
      const hex = uint8ArrayToHex(key32);
      expect(hexToUint8Array(hex)).toEqual(key32);
    });

    it('known vector', () => {
      expect(uint8ArrayToHex(new Uint8Array([0x00, 0xff, 0x0a]))).toBe('00ff0a');
    });
  });
});

// ── Invite payload encode / decode ──────────────────────────────────────────

describe('invite payload encode/decode', () => {
  // Inline encode (from AccessControl.tsx) and decode (from InvitePage.tsx)
  function encodePayload(seed: Uint8Array, archive: Uint8Array): string {
    const payload = new Uint8Array(4 + seed.length + archive.length);
    const view = new DataView(payload.buffer);
    view.setUint32(0, seed.length);
    payload.set(seed, 4);
    payload.set(archive, 4 + seed.length);
    let binary = '';
    for (let i = 0; i < payload.length; i++) binary += String.fromCharCode(payload[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePayload(b64url: string): { seed: Uint8Array; archive: Uint8Array } {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const view = new DataView(bytes.buffer);
    const seedLen = view.getUint32(0);
    const seed = bytes.slice(4, 4 + seedLen);
    const archive = bytes.slice(4 + seedLen);
    return { seed, archive };
  }

  it('round-trips with 32-byte seed', () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const archive = crypto.getRandomValues(new Uint8Array(200));
    const encoded = encodePayload(seed, archive);
    const decoded = decodePayload(encoded);
    expect(decoded.seed).toEqual(seed);
    expect(decoded.archive).toEqual(archive);
  });

  it('handles empty archive', () => {
    const seed = new Uint8Array([1, 2, 3]);
    const archive = new Uint8Array(0);
    const decoded = decodePayload(encodePayload(seed, archive));
    expect(decoded.seed).toEqual(seed);
    expect(decoded.archive).toEqual(archive);
  });

  it('handles large archive', () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const archive = crypto.getRandomValues(new Uint8Array(10_000));
    const decoded = decodePayload(encodePayload(seed, archive));
    expect(decoded.seed).toEqual(seed);
    expect(decoded.archive).toEqual(archive);
  });
});

// ── Signing & verification (WASM) ──────────────────────────────────────────

describe('signing & verification', () => {
  let signer: Signer;
  let keyhive: Keyhive;
  let peerId: PeerId;

  beforeAll(async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    signer = Signer.memorySignerFromBytes(seed);
    const store = CiphertextStore.newInMemory();
    keyhive = await Keyhive.init(signer, store, () => {});
    peerId = peerIdFromSigner(signer);
  });

  it('sign then verify succeeds', async () => {
    const payload = new TextEncoder().encode('hello world');
    const signedBytes = await signData(keyhive, payload);
    const decoded = decodeKeyhiveMessageData(signedBytes);
    expect(decoded).toBeDefined();
    expect(verifyData(peerId, decoded!)).toBe(true);
  });

  it('verify fails with wrong peer ID', async () => {
    const payload = new TextEncoder().encode('test');
    const signedBytes = await signData(keyhive, payload);
    const decoded = decodeKeyhiveMessageData(signedBytes);
    expect(decoded).toBeDefined();

    const wrongKey = crypto.getRandomValues(new Uint8Array(32));
    const wrongPeerId = peerIdFromVerifyingKey(wrongKey);
    expect(verifyData(wrongPeerId, decoded!)).toBe(false);
  });

  it('peerIdFromSigner matches peerIdFromVerifyingKey', () => {
    const fromSigner = peerIdFromSigner(signer);
    const fromKey = peerIdFromVerifyingKey(signer.verifyingKey);
    expect(fromSigner).toBe(fromKey);
  });

  it('signed data includes contact card when provided', async () => {
    const contactCard = await keyhive.contactCard();
    const payload = new TextEncoder().encode('with card');
    const signedBytes = await signData(keyhive, payload, contactCard);
    const decoded = decodeKeyhiveMessageData(signedBytes);
    expect(decoded).toBeDefined();
    expect(decoded!.contactCard).toBeDefined();
  });
});

// ── Invite round-trip (WASM) ────────────────────────────────────────────────

describe('invite round-trip', () => {
  it('generates and claims an invite with write access', async () => {
    // --- Admin (A) creates keyhive and document ---
    const seedA = crypto.getRandomValues(new Uint8Array(32));
    const signerA = Signer.memorySignerFromBytes(seedA);
    const storeA = CiphertextStore.newInMemory();
    const khA = await Keyhive.init(signerA, storeA, () => {});

    const dummyChangeId = new ChangeId(new Uint8Array(32));
    const doc = await khA.generateDocument([], dummyChangeId, []);

    // --- A generates an invite ---
    const inviteSeed = crypto.getRandomValues(new Uint8Array(32));
    const inviteSigner = Signer.memorySignerFromBytes(inviteSeed);
    const inviteStore = CiphertextStore.newInMemory();
    const tempKh = await Keyhive.init(inviteSigner, inviteStore, () => {});

    // Exchange contact cards: A receives tempKh's card
    const tempCard = await tempKh.contactCard();
    const tempIndividual = await khA.receiveContactCard(tempCard);
    const tempAgent = tempIndividual.toAgent();

    // Grant write access
    const writeAccess = Access.tryFromString('write');
    expect(writeAccess).toBeDefined();
    await khA.addMember(tempAgent, doc.toMembered(), writeAccess!, []);

    // Serialize A's archive (contains the delegation)
    const archiveA = await khA.toArchive();
    const archiveBytes = archiveA.toBytes();

    // --- B claims the invite ---
    const seedB = crypto.getRandomValues(new Uint8Array(32));
    const signerB = Signer.memorySignerFromBytes(seedB);

    // Reconstruct invite keyhive from archive
    const claimStore1 = CiphertextStore.newInMemory();
    const inviterArchive = new Archive(archiveBytes);
    const inviteKh = await inviterArchive.tryToKeyhive(claimStore1, inviteSigner, () => {});

    // B exchanges contact card with invite keyhive
    const storeB = CiphertextStore.newInMemory();
    const khB_temp = await Keyhive.init(signerB, storeB, () => {});
    const cardB = await khB_temp.contactCard();
    const individualB = await inviteKh.receiveContactCard(cardB);
    const agentB = individualB.toAgent();

    // Check reachable docs from invite
    const reachable = await inviteKh.reachableDocs();
    expect(reachable.length).toBeGreaterThan(0);

    const inviteDoc = reachable[0].doc;
    const inviteAccess = reachable[0].access;

    // Add B as member
    await inviteKh.addMember(agentB, inviteDoc.toMembered(), inviteAccess, []);

    // Rebuild B's keyhive from the updated archive using B's signer
    const updatedArchive = await inviteKh.toArchive();
    const claimStore2 = CiphertextStore.newInMemory();
    const khB = await updatedArchive.tryToKeyhive(claimStore2, signerB, () => {});

    // --- Verify B has access ---
    const bReachable = await khB.reachableDocs();
    expect(bReachable.length).toBeGreaterThan(0);

    // B can see the same document
    expect(bReachable[0].doc.doc_id.toString()).toBe(inviteDoc.doc_id.toString());
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
