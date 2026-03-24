import {
  Message,
  NetworkAdapter,
  PeerId,
  PeerMetadata,
} from "@automerge/automerge-repo/slim";
// FORK: CGKA encryption — additional keyhive types for encrypt/decrypt
import {
  ChangeId,
  ContactCard,
  Document as KeyhiveDocument,
  DocumentId as KeyhiveDocumentId,
  Encrypted,
  Identifier,
  Keyhive,
} from "@keyhive/keyhive/slim";
import {
  decodeKeyhiveMessageData,
  ENC_ENCRYPTED,
  signData,
  verifyData,
} from "./messages";
import { PromiseQueue, Pending } from "./pending";
import { Metrics } from "./metrics";
import type { EventCache } from "./event-cache";
import { StandardEventCache } from "./standard-event-cache";
import { EventBytesOnlyEventCache } from "./event-bytes-only-event-cache";
import { PeriodicEventCache } from "./periodic-event-cache";
import { MessageBatch, BatchProcessor } from "./batch";
import {
  KeyhiveStorage,
} from "../keyhive/keyhive";
import { SyncProtocol } from "./sync-protocol";
import { Peer } from "./peer";
// FORK: CGKA encryption — detect keyhive peers for signature verification
import { isKeyhivePeerId, keyhiveIdentifierFromPeerId } from "../utilities";

export interface KeyhiveNetworkAdapterOptions {
  networkAdapter: NetworkAdapter;
  contactCard: ContactCard;
  keyhive: Keyhive;
  keyhiveStorage: KeyhiveStorage;
  keyhiveQueue: PromiseQueue;
  periodicallyRequestSync: boolean;
  cachingMode?: "none" | "standard" | "periodic";
  // TODO: Replace with dynamic configuration
  hardcodedRemoteId?: PeerId | null;
  syncRequestInterval: number;
  batchInterval?: number;
  retryPendingFromStorage?: boolean;
  enableCompaction?: boolean;
  archiveThreshold?: number;
}

export class KeyhiveNetworkAdapter extends NetworkAdapter {
  private pending = new Pending();
  private peers: Map<PeerId, Peer> = new Map();
  private syncIntervalId?: ReturnType<typeof setInterval>;
  private compactionIntervalId?: ReturnType<typeof setInterval>;
  private batchProcessor?: BatchProcessor;

  private periodicCacheRefreshId?: ReturnType<typeof setInterval>;

  private networkAdapter: NetworkAdapter;
  private keyhive: Keyhive;
  private keyhiveStorage: KeyhiveStorage;
  private keyhiveQueue: PromiseQueue;
  // TODO: Replace with dynamic configuration
  private hardcodedRemoteId: PeerId | null;

  private batchInterval: number | undefined;
  private keyhiveMsgBatch: MessageBatch;
  private streamingMetrics = new Metrics();
  private metricsIntervalId?: ReturnType<typeof setInterval>;

  private syncProtocol: SyncProtocol;

  // FORK: CGKA encryption — maps automerge DocumentId strings to keyhive DocumentIds
  private docMap: Map<string, KeyhiveDocumentId> = new Map();
  // FORK: CGKA encryption — cache of fetched keyhive Document objects
  private docObjects: Map<string, KeyhiveDocument> = new Map();
  // FORK: CGKA encryption — tracks the last ChangeId per document for pred_refs chaining
  private lastChangeIdByDoc: Map<string, ChangeId> = new Map();
  // FORK: CGKA encryption — messages that failed decryption, retried after keyhive sync
  private pendingDecrypt: { message: Message; rawPayload: Uint8Array; automergeDocId: string; retries: number }[] = [];
  // FORK: CGKA encryption — maps peer IDs to their keyhive Identifier from contact card exchange
  private peerContactCardIds: Map<string, Identifier> = new Map();

  private static readonly MAX_DECRYPT_RETRIES = 50;

  constructor(options: KeyhiveNetworkAdapterOptions) {
    super();

    const {
      networkAdapter,
      contactCard,
      keyhive,
      keyhiveStorage,
      keyhiveQueue,
      periodicallyRequestSync,
      cachingMode = "none",
      hardcodedRemoteId = null,
      syncRequestInterval,
      batchInterval,
      retryPendingFromStorage = true,
      enableCompaction = true,
      archiveThreshold = 200,
    } = options;

    this.networkAdapter = networkAdapter;
    this.keyhive = keyhive;
    this.keyhiveStorage = keyhiveStorage;
    this.keyhiveQueue = keyhiveQueue;
    this.hardcodedRemoteId = hardcodedRemoteId;

    let cache: EventCache;
    if (cachingMode === "periodic") {
      const periodicCache = new PeriodicEventCache();
      cache = periodicCache;
      this.periodicCacheRefreshId = setInterval(() => {
        void this.keyhiveQueue.run(() => periodicCache.refresh(this.keyhive)).catch((error) =>
          console.error("[AMRepoKeyhive] PeriodicEventCache refresh failed:", error)
        );
      }, syncRequestInterval);
      void this.keyhiveQueue.run(() => periodicCache.refresh(this.keyhive)).catch((error) =>
        console.error("[AMRepoKeyhive] Initial PeriodicEventCache refresh failed:", error)
      );
    } else if (cachingMode === "standard") {
      cache = new StandardEventCache();
    } else {
      cache = new EventBytesOnlyEventCache();
    }

    // FORK: CGKA encryption — wrap SyncProtocol's emit to trigger decrypt retry
    // and store peerContactCardIds from contact card exchange
    this.syncProtocol = new SyncProtocol(
      {
        keyhive,
        keyhiveStorage,
        keyhiveQueue,
        peers: this.peers,
        contactCard,
        cache,
        getPeerId: () => this.peerId,
        getMetrics: () => this.streamingMetrics,
        send: (message, contactCard?) => this.send(message, contactCard),
        emit: (event) => {
          (this.emit as any)(event);
          // FORK: CGKA encryption — after ingesting remote ops, CGKA keys may
          // now be available. Retry buffered messages.
          if (event === "ingest-remote") {
            this.retryPendingDecrypt();
          }
        },
      },
      {
        archiveThreshold,
        retryPendingFromStorage,
        minSyncRequestInterval: 1000,
        minSyncResponseInterval: 1000,
      },
    );

    if (periodicallyRequestSync) {
        this.syncIntervalId = setInterval(
          () => this.syncProtocol.requestKeyhiveSync(),
          syncRequestInterval,
        );
    }

    if (enableCompaction) {
      this.compactionIntervalId = setInterval(
        this.runCompaction.bind(this),
        60000
      );
    }

    networkAdapter.on("message", (msg) => {
      this.receiveMessage(msg);
    });

    networkAdapter.on("peer-candidate", (payload) => {
      if (this.peerId && payload.peerId === this.peerId) {
        console.warn(`[AMRepoKeyhive] Received peer-candidate msg with our own peerID`);
        return;
      }
      console.debug(`[AMRepoKeyhive] peer-candidate: ${payload.peerId}`);
      this.emit("peer-candidate", payload);
      this.peers.set(payload.peerId, new Peer());
    });

    networkAdapter.on("peer-disconnected", (payload) => {
      this.emit("peer-disconnected", payload);
      this.peers.delete(payload.peerId);
      this.syncProtocol.onPeerDisconnected(payload.peerId);
    });

    this.keyhiveMsgBatch = new MessageBatch();

    this.batchInterval = batchInterval;
    if (this.isBatching()) {
      this.batchProcessor = new BatchProcessor(
        this.batchInterval!,
        this.keyhive,
        async (message, data, metrics) => {
          // FORK: CGKA encryption — store peerContactCardIds before delegating
          if (data.contactCard) {
            this.peerContactCardIds.set(message.senderId, data.contactCard.id);
          }
          const handled = await this.syncProtocol.handleKeyhiveMessage(message, data, metrics);
          if (!handled) {
            this.emit("message", message);
          }
        },
        () => {
          const old = this.keyhiveMsgBatch;
          this.keyhiveMsgBatch = new MessageBatch();
          return old;
        },
      );
      this.batchProcessor.start();
    } else {
      this.metricsIntervalId = setInterval(async () => {
        const stats = await this.keyhive.stats();
        this.streamingMetrics.recordTotalOps(stats.totalOps);
        this.streamingMetrics.logReport("Streaming");
        this.streamingMetrics = new Metrics();
      }, 1000);
    }
  }

  // FORK: CGKA encryption — helper to get hex ID for debug logging
  private static _idHex(id: Identifier): string {
    try { return Array.from(id.toBytes() as Uint8Array).map((b: number) => b.toString(16).padStart(2, '0')).join(''); } catch { return '??'; }
  }

  // FORK: CGKA encryption — get all known keyhive Identifiers for a peer
  private identifiersForPeer(peerId: PeerId): Identifier[] {
    const fromPeerId = keyhiveIdentifierFromPeerId(peerId);
    const fromContactCard = this.peerContactCardIds.get(peerId);
    if (!fromContactCard) return [fromPeerId];
    if (fromContactCard.toBytes().toString() === fromPeerId.toBytes().toString()) return [fromPeerId];
    return [fromContactCard, fromPeerId];
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    console.log(`[AMRepoKeyhive] connect: peerId=${peerId}`);
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    this.networkAdapter.connect(peerId, peerMetadata);
  }

  isReady(): boolean {
    return this.networkAdapter.isReady();
  }

  whenReady(): Promise<void> {
    return this.networkAdapter.whenReady();
  }

  isBatching(): boolean {
    return this.batchInterval !== undefined
  }

  disconnect(): void {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = undefined;
    }
    if (this.compactionIntervalId) {
      clearInterval(this.compactionIntervalId);
      this.compactionIntervalId = undefined;
    }
    if (this.batchProcessor) {
      this.batchProcessor.stop();
      this.batchProcessor = undefined;
    }
    if (this.periodicCacheRefreshId) {
      clearInterval(this.periodicCacheRefreshId);
      this.periodicCacheRefreshId = undefined;
    }
    if (this.metricsIntervalId) {
      clearInterval(this.metricsIntervalId);
      this.metricsIntervalId = undefined;
    }
    this.networkAdapter.disconnect();
  }

  // FORK: CGKA encryption — force automerge-repo to re-sync with all connected
  // peers by cycling peer-disconnected → peer-candidate events. Called after
  // keyhive state changes (e.g., new member ingested, CGKA key rotation).
  forceResyncAllPeers(): void {
    this.docObjects.clear();
    for (const [peerId, peer] of this.peers) {
      peer.keyhiveSynced = false;
      this.emit("peer-disconnected", { peerId });
      this.emit("peer-candidate", { peerId, peerMetadata: {} });
    }
  }

  // FORK: CGKA encryption — register mapping from automerge DocumentId to keyhive DocumentId.
  registerDoc(automergeDocId: string, khDocId: KeyhiveDocumentId): void {
    this.docMap.set(automergeDocId, khDocId);
    void this.getOrFetchDocument(automergeDocId);
    this.retryPendingDecrypt();
  }

  // FORK: CGKA encryption — fetch (and cache) the keyhive Document for a given automerge doc ID.
  private async getOrFetchDocument(automergeDocId: string): Promise<KeyhiveDocument | null> {
    const cached = this.docObjects.get(automergeDocId);
    if (cached) return cached;
    const khDocId = this.docMap.get(automergeDocId);
    if (!khDocId) return null;
    const doc = await this.keyhive.getDocument(khDocId);
    if (doc) this.docObjects.set(automergeDocId, doc);
    return doc ?? null;
  }

  send(message: Message, contactCard?: ContactCard): void {
    if (this.peerId === undefined) {
      throw new Error("peerId must be defined!");
    }
    void this.signAndSend(message, contactCard).catch((error) =>
      console.error(`[AMRepoKeyhive] Failed to sign and send (type=${message.type}):`, error)
    );
  }

  // FORK: CGKA encryption — signAndSend is extended to encrypt doc payloads
  async signAndSend(
    message: Message,
    contactCard?: ContactCard
  ): Promise<void> {
    if (this.peerId === undefined) {
      throw new Error("peerId must be defined!");
    }
    let data: Uint8Array =
      "data" in message && message.data !== undefined
        ? message.data
        : new Uint8Array();
    const seqNumber = this.pending.register();
    try {
      // FORK: CGKA encryption — determine if this message should be encrypted
      const automergeDocId = (message as any).documentId as string | undefined;
      const targetId = (message as any).targetId as PeerId | undefined;
      const isDocMessage =
        automergeDocId !== undefined &&
        this.docMap.has(automergeDocId) &&
        (message.type === "sync" || message.type === "change") &&
        data.length > 0;

      // FORK: CGKA encryption — drop doc messages for peers that haven't completed
      // keyhive sync (they lack CGKA keys). automerge-repo will re-sync after
      // keyhiveSynced becomes true.
      if (isDocMessage && targetId) {
        const peer = this.peers.get(targetId);
        if (peer && !peer.keyhiveSynced) {
          this.pending.fire(seqNumber, () => {});
          return;
        }
      }

      const shouldEncrypt = isDocMessage;
      let hashBuf: ArrayBuffer | undefined;
      if (shouldEncrypt) {
        hashBuf = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
      }

      // FORK: CGKA encryption — encrypt (if applicable) and sign in a single
      // queue slot to prevent concurrent WASM access
      const signedData = await this.keyhiveQueue.run(async () => {
        let payload = data;
        if (shouldEncrypt && hashBuf && automergeDocId) {
          let doc = this.docObjects.get(automergeDocId);
          if (!doc) {
            const khDocId = this.docMap.get(automergeDocId);
            if (khDocId) {
              const fetched = await this.keyhive.getDocument(khDocId);
              if (fetched) { this.docObjects.set(automergeDocId, fetched); doc = fetched; }
            }
          }
          if (doc) {
            try {
              const contentRef = new ChangeId(new Uint8Array(hashBuf));
              const predRef = this.lastChangeIdByDoc.get(automergeDocId);
              // Delete before tryEncrypt: tryEncrypt synchronously calls __destroy_into_raw()
              // on doc, zeroing its ptr. If tryEncrypt then rejects, the ptr=0 wrapper must
              // not remain in docObjects (it would panic on the next call).
              this.docObjects.delete(automergeDocId);
              this.lastChangeIdByDoc.set(automergeDocId, new ChangeId(new Uint8Array(hashBuf)));
              const result = await this.keyhive.tryEncrypt(doc, contentRef, predRef ? [predRef] : [], data);
              if (result.update_op()) {
                // CGKA key rotation — force a full sync so the new op reaches all peers
                this.invalidateCaches();
                for (const peer of this.peers.values()) peer.forceFullSync = true;
                setTimeout(() => this.syncKeyhive(), 0);
              }
              const encBytes = result.encrypted_content().toBytes();
              payload = new Uint8Array(1 + encBytes.length);
              payload[0] = ENC_ENCRYPTED;
              payload.set(encBytes, 1);
            } catch (e) {
              console.error(`[AMRepoKeyhive] encryptPayload failed for doc ${automergeDocId}:`, e);
            }
          } else {
            console.error(`[AMRepoKeyhive] could not fetch keyhive doc for ${automergeDocId}, sending unencrypted`);
          }
        }
        return signData(this.keyhive, payload, contactCard);
      });
      await this.networkAdapter.whenReady();
      this.pending.fire(seqNumber, () => {
        // FORK: CGKA encryption — ensure senderId matches the signing key
        message.senderId = this.peerId!;
        message.data = signedData;
        this.networkAdapter.send(message);
      });
    } catch (error) {
      console.error(
        `[AMRepoKeyhive] asyncSignAndSend FAILED for seq=${seqNumber}, type=${message.type}:`,
        error
      );
      this.pending.cancel(seqNumber);
    }
  }

  // FORK: CGKA encryption — check if a peer has write access to a document
  private async peerHasWriteAccess(senderId: PeerId, automergeDocId: string): Promise<boolean> {
    const khDocId = this.docMap.get(automergeDocId);
    if (!khDocId) return true; // unshared doc
    try {
      const senderIdentifiers = this.identifiersForPeer(senderId);
      let access: any = undefined;
      for (const id of senderIdentifiers) {
        access = await this.keyhive.accessForDoc(id, khDocId);
        if (access) break;
      }
      if (!access) {
        try {
          const members = await this.keyhive.docMemberCapabilities(khDocId);
          const idHexes = senderIdentifiers.map(id => KeyhiveNetworkAdapter._idHex(id)).join(', ');
          console.warn(`[AMRepoKeyhive] No access for peer ${senderId} on doc ${automergeDocId} — blocking sync`);
          console.warn(`[AMRepoKeyhive]   senderIdentifiers=${idHexes}`);
          for (const m of members) {
            const mIdHex = m.who.id ? KeyhiveNetworkAdapter._idHex(m.who.id) : '??';
            console.warn(`[AMRepoKeyhive]   member: ${mIdHex} ${m.can.toString()} (${m.who.isIndividual() ? 'individual' : 'group'})`);
          }
        } catch (e) {
          console.warn(`[AMRepoKeyhive] No access for peer ${senderId} on doc ${automergeDocId} — blocking sync (member dump failed: ${e})`);
        }
        return false;
      }
      const accessStr = access.toString();
      const canWrite = accessStr === "Admin" || accessStr === "Write";
      if (!canWrite) {
        console.warn(`[AMRepoKeyhive] Peer ${senderId} has ${accessStr} access on doc ${automergeDocId} — blocking sync`);
      }
      return canWrite;
    } catch (err) {
      console.warn(`[AMRepoKeyhive] Access check failed for peer ${senderId} on doc ${automergeDocId}:`, err);
      return false;
    }
  }

  // FORK: CGKA encryption — async wrapper that checks write access before emitting
  private async checkAccessAndEmit(message: Message): Promise<void> {
    const docId = (message as any).documentId as string;
    const hasAccess = await this.keyhiveQueue.run(() =>
      this.peerHasWriteAccess(message.senderId, docId)
    );
    if (hasAccess) {
      this.emit("message", message);
    } else {
      console.warn(`[AMRepoKeyhive] DROPPED sync message from ${message.senderId} for doc ${docId} (insufficient access)`);
    }
  }

  // FORK: CGKA encryption — receiveMessage is extended to decrypt doc payloads
  receiveMessage(message: Message): void {
    try {
      if (
        this.hardcodedRemoteId &&
        message.senderId !== this.hardcodedRemoteId
      ) {
        console.debug(
          `[AMRepoKeyhive] Unknown remote peer ${message.senderId}. Ignoring message!`
        );
        return;
      }
      if (!("data" in message) || message.data === undefined) {
        this.emit("message", message);
        return;
      }
      // FORK: CGKA encryption — non-keyhive peers (e.g. relay server) aren't signed
      if (!isKeyhivePeerId(message.senderId)) {
        this.emit("message", message);
        return;
      }
      const maybeKeyhiveMessageData = decodeKeyhiveMessageData(message.data);
      if (maybeKeyhiveMessageData) {
        // FORK: CGKA encryption — verify inside the queue to prevent concurrent WASM access
        void this.keyhiveQueue.run(async () => {
          if (verifyData(message.senderId, maybeKeyhiveMessageData)) {
            if (!message.type?.startsWith("keyhive-")) {
              if (this.isBatching()) {
                this.keyhiveMsgBatch.countNonKeyhive();
              } else {
                this.streamingMetrics.recordNonKeyhive();
              }
              const rawPayload = maybeKeyhiveMessageData.signed.payload;
              // FORK: CGKA encryption — decrypt encrypted doc payloads
              const automergeDocId = (message as any).documentId as string | undefined;
              const isEncrypted = rawPayload && rawPayload.length > 0 && rawPayload[0] === ENC_ENCRYPTED;
              const inDocMap = automergeDocId ? this.docMap.has(automergeDocId) : false;
              if (automergeDocId && inDocMap &&
                  (message.type === "sync" || message.type === "change") &&
                  isEncrypted) {
                void this.keyhiveQueue.run(async () => {
                  try {
                    let doc = this.docObjects.get(automergeDocId);
                    if (!doc) {
                      const khDocId = this.docMap.get(automergeDocId);
                      if (khDocId) {
                        const fetched = await this.keyhive.getDocument(khDocId);
                        if (fetched) { this.docObjects.set(automergeDocId, fetched); doc = fetched; }
                      }
                    }
                    if (!doc) {
                      console.error(`[AMRepoKeyhive] decryptPayload: no keyhive doc for ${automergeDocId}, dropping message`);
                      return;
                    }
                    try {
                      const encrypted = (Encrypted as any).fromBytes(rawPayload.slice(1));
                      const decrypted = await this.keyhive.tryDecrypt(doc, encrypted);
                      if (!decrypted) {
                        console.error(`[AMRepoKeyhive] tryDecrypt returned null for doc ${automergeDocId}, dropping message`);
                        return;
                      }
                      message.data = decrypted;
                      if (message.type === "sync" || message.type === "request") {
                        void this.checkAccessAndEmit(message);
                      } else {
                        this.emit("message", message);
                      }
                    } catch (e: any) {
                      const errDetail = typeof e?.message === 'function' ? e.message() : (e?.message ?? String(e));
                      console.warn(`[AMRepoKeyhive] decryptPayload failed for doc ${automergeDocId}, buffering for retry (${this.pendingDecrypt.length + 1} pending): ${errDetail}`);
                      this.pendingDecrypt.push({ message, rawPayload, automergeDocId, retries: 0 });
                    }
                  } catch (outerErr: any) {
                    console.error(`[AMRepoKeyhive] DECRYPT-TASK: unexpected error for doc=${automergeDocId}:`, outerErr);
                  }
                });
              } else if (rawPayload && rawPayload.length > 0 && rawPayload[0] === ENC_ENCRYPTED) {
                // FORK: CGKA encryption — encrypted payload but doc not yet registered
                if (automergeDocId) {
                  console.warn(`[AMRepoKeyhive] encrypted msg for unmapped doc ${automergeDocId}, buffering for retry (${this.pendingDecrypt.length + 1} pending)`);
                  this.pendingDecrypt.push({ message, rawPayload, automergeDocId, retries: 0 });
                } else {
                  console.error(`[AMRepoKeyhive] encrypted msg with no documentId, dropping`);
                }
              } else {
                // Genuinely unencrypted payload (e.g. from server relay)
                message.data = rawPayload;
                this.emit("message", message);
              }
            } else if (this.isBatching()) {
              // FORK: CGKA encryption — store peerContactCardIds before batching
              if (maybeKeyhiveMessageData.contactCard) {
                this.peerContactCardIds.set(message.senderId, maybeKeyhiveMessageData.contactCard.id);
              }
              this.keyhiveMsgBatch.add(message, maybeKeyhiveMessageData);
            } else {
              this.streamingMetrics.recordMessage(
                message.type, message.senderId,
                maybeKeyhiveMessageData.signed.payload?.byteLength ?? 0,
              );
              // FORK: CGKA encryption — store peerContactCardIds before handling
              if (maybeKeyhiveMessageData.contactCard) {
                this.peerContactCardIds.set(message.senderId, maybeKeyhiveMessageData.contactCard.id);
              }
              const startTime = Date.now();
              const msgType = message.type ?? "unknown";
              void this.syncProtocol.handleKeyhiveMessage(message, maybeKeyhiveMessageData, this.streamingMetrics).then((handled) => {
                const elapsed = Date.now() - startTime;
                this.streamingMetrics.recordProcessingTime(elapsed);
                this.streamingMetrics.recordProcessingTimeByType(msgType, elapsed);
                if (!handled) {
                  this.emit("message", message);
                }
              }).catch((error) =>
                console.error(`[AMRepoKeyhive] Error handling message (type=${message.type}, from=${message.senderId}):`, error)
              );
            }
          } else {
            console.error(
              `[AMRepoKeyhive] verifyData FAILED for type=${message.type} from=${message.senderId} doc=${(message as any).documentId}`
            );
          }
        });
      } else {
        // FORK: CGKA encryption — peer has keyhive-looking ID but message isn't signed
        // (e.g. relay server). Pass through as-is.
        this.emit("message", message);
      }
    } catch (e) {
      console.error("[AMRepoKeyhive] Could not decode signed message:", e);
      return;
    }
  }

  syncKeyhive(
    maybeSenderId: PeerId | undefined = undefined,
    includeContactCard: boolean = false,
    attemptRecovery: boolean = false
  ): void {
    this.syncProtocol.syncKeyhive(maybeSenderId, includeContactCard, attemptRecovery);
  }

  invalidateCaches(): void {
    this.syncProtocol.invalidateCaches();
  }

  // FORK: CGKA encryption — retry buffered messages that failed decryption
  private retryPendingDecrypt(): void {
    if (this.pendingDecrypt.length === 0) return;
    const pending = this.pendingDecrypt.splice(0);
    this.docObjects.clear();
    for (const entry of pending) {
      const { message, rawPayload, automergeDocId } = entry;
      void this.keyhiveQueue.run(async () => {
        let doc = this.docObjects.get(automergeDocId);
        if (!doc) {
          const khDocId = this.docMap.get(automergeDocId);
          if (khDocId) {
            const fetched = await this.keyhive.getDocument(khDocId);
            if (fetched) { this.docObjects.set(automergeDocId, fetched); doc = fetched; }
          }
        }
        if (!doc) {
          if (entry.retries < KeyhiveNetworkAdapter.MAX_DECRYPT_RETRIES) {
            entry.retries++;
            this.pendingDecrypt.push(entry);
          } else {
            console.warn(`[AMRepoKeyhive] dropping buffered msg for unmapped doc ${automergeDocId} after ${entry.retries} retries`);
          }
          return;
        }
        try {
          const encrypted = (Encrypted as any).fromBytes(rawPayload.slice(1));
          const decrypted = await this.keyhive.tryDecrypt(doc, encrypted);
          if (!decrypted) {
            console.warn(`[AMRepoKeyhive] RETRY-DECRYPT: tryDecrypt returned null for doc ${automergeDocId}`);
            return;
          }
          message.data = decrypted;
          if (message.type === "sync" || message.type === "request") {
            void this.checkAccessAndEmit(message);
          } else {
            this.emit("message", message);
          }
        } catch (e: any) {
          const errDetail = typeof e?.message === 'function' ? e.message() : (e?.message ?? String(e));
          if (entry.retries < KeyhiveNetworkAdapter.MAX_DECRYPT_RETRIES) {
            entry.retries++;
            console.warn(`[AMRepoKeyhive] RETRY-DECRYPT failed for doc ${automergeDocId} (attempt ${entry.retries}/${KeyhiveNetworkAdapter.MAX_DECRYPT_RETRIES}): ${errDetail}`);
            this.pendingDecrypt.push(entry);
          } else {
            console.warn(`[AMRepoKeyhive] dropping undecryptable msg for doc ${automergeDocId} after ${entry.retries} retries: ${errDetail}`);
          }
        }
      });
    }
  }

  private runCompaction(): void {
    void this.keyhiveQueue.run(async () => {
      await this.keyhiveStorage.compact(this.keyhive);
    }).catch((error) =>
      console.error("[AMRepoKeyhive] Compaction failed:", error)
    );
  }
}
