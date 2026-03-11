import { WebSocket } from 'ws';
import { Encoder, decode } from 'cbor-x';

// Use the same encoder settings as @automerge/automerge-repo's cbor helper
const encoder = new Encoder({ tagUint8Array: false, useRecords: false });

const RELAY_PEER_ID = `relay-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Pure WebSocket relay for automerge-repo peers.
 *
 * When a peer connects the relay:
 *  1. Completes the automerge-repo peer handshake (join → peer).
 *  2. Announces all currently connected peers to the newcomer (extra "peer"
 *     messages) so each client discovers the others directly.
 *  3. Announces the newcomer to each existing peer symmetrically.
 *
 * After discovery, all sync/keyhive messages are forwarded verbatim:
 *  - If a message has a targetId that matches a known peer → unicast.
 *  - Otherwise (targetId is the relay or absent) → broadcast to all others.
 *
 * Because the relay never interprets or re-wraps the keyhive-signed `data`
 * field, the original sender's keyhive signature is always preserved end-to-end.
 */
export class WebSocketRelay {
  private sockets = new Map<string, WebSocket>();

  handleConnection(ws: WebSocket): void {
    let myPeerId: string | null = null;

    ws.on('message', (rawData: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = normalizeBuffer(rawData);

      let message: any;
      try {
        message = decode(buf);
      } catch (e) {
        console.error('[relay] Failed to decode CBOR message:', e);
        return;
      }

      if (message.type === 'join') {
        myPeerId = message.senderId as string;

        // Close any stale connection for this peer ID
        const existing = this.sockets.get(myPeerId);
        if (existing && existing !== ws) {
          existing.close();
        }
        this.sockets.set(myPeerId, ws);

        console.log(`[relay] peer joined: ${myPeerId} (${this.sockets.size} total)`);

        const version = (message.supportedProtocolVersions as string[])?.[0] ?? '1';

        // Required handshake: relay acknowledges the new peer
        ws.send(encoder.encode({
          type: 'peer',
          senderId: RELAY_PEER_ID,
          targetId: myPeerId,
          peerMetadata: {},
          selectedProtocolVersion: version,
        }));

        // Mutual peer discovery between the newcomer and all existing peers
        for (const [existingId, existingWs] of this.sockets) {
          if (existingId === myPeerId || existingWs.readyState !== WebSocket.OPEN) continue;

          // Introduce the existing peer to the newcomer
          ws.send(encoder.encode({
            type: 'peer',
            senderId: existingId,
            targetId: myPeerId,
            peerMetadata: {},
            selectedProtocolVersion: version,
          }));

          // Introduce the newcomer to the existing peer
          existingWs.send(encoder.encode({
            type: 'peer',
            senderId: myPeerId,
            targetId: existingId,
            peerMetadata: {},
            selectedProtocolVersion: version,
          }));
        }
      } else if (myPeerId) {
        const targetId = message.targetId as string | undefined;

        if (targetId && targetId !== RELAY_PEER_ID && this.sockets.has(targetId)) {
          // Unicast: deliver raw bytes to the named peer
          const targetWs = this.sockets.get(targetId)!;
          if (targetWs.readyState === WebSocket.OPEN) {
            targetWs.send(buf);
          }
        } else {
          // Broadcast: message addressed to relay or has no specific target
          for (const [pid, peerWs] of this.sockets) {
            if (pid === myPeerId || peerWs.readyState !== WebSocket.OPEN) continue;
            peerWs.send(buf);
          }
        }
      }
    });

    ws.on('close', () => {
      if (myPeerId) {
        this.sockets.delete(myPeerId);
        console.log(`[relay] peer left: ${myPeerId} (${this.sockets.size} remaining)`);

        // Notify remaining peers of the departure
        const leaveMsg = encoder.encode({ type: 'leave', senderId: myPeerId });
        for (const peerWs of this.sockets.values()) {
          if (peerWs.readyState === WebSocket.OPEN) {
            peerWs.send(leaveMsg);
          }
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[relay] WebSocket error:', err);
    });
  }
}

function normalizeBuffer(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
