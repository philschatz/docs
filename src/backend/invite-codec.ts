/**
 * Node.js port of src/client/invite/invite-codec.ts.
 *
 * Wire format: [4-byte seed length (big-endian)] [seed] [archive]
 * The payload is gzip-compressed then base64url-encoded.
 */
import { gunzipSync, gzipSync } from 'zlib';

function toBase64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(b64url: string): Buffer {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64');
}

export function encodeInvitePayload(seed: Uint8Array, archive: Uint8Array): string {
  const payload = Buffer.alloc(4 + seed.length + archive.length);
  payload.writeUInt32BE(seed.length, 0);
  payload.set(seed, 4);
  payload.set(archive, 4 + seed.length);
  const compressed = gzipSync(payload);
  return toBase64url(compressed);
}

export function decodeInvitePayload(b64url: string): { seed: Uint8Array; archive: Uint8Array } {
  const compressed = fromBase64url(b64url);
  let bytes: Buffer;
  try {
    bytes = gunzipSync(compressed);
  } catch {
    // Fall back to uncompressed for old invite links
    bytes = compressed;
  }
  const seedLen = bytes.readUInt32BE(0);
  const seed = new Uint8Array(bytes.subarray(4, 4 + seedLen));
  const archive = new Uint8Array(bytes.subarray(4 + seedLen));
  return { seed, archive };
}

/**
 * Parse an invite URL and extract the docId and payload.
 * Supports formats:
 *   http://host/#/invite/{docId}/{docType}/{payload}
 *   http://host/#/invite/{docId}/{payload}
 */
export function parseInviteUrl(url: string): { docId: string; docType?: string; payload: string } {
  const hash = url.includes('#') ? url.split('#')[1] : url;
  const parts = hash.replace(/^\//, '').split('/');
  // parts: ["invite", docId, docType?, payload]
  if (parts[0] !== 'invite' || parts.length < 3) {
    throw new Error('Invalid invite URL format');
  }
  if (parts.length >= 4) {
    return { docId: parts[1], docType: parts[2], payload: parts[3] };
  }
  return { docId: parts[1], payload: parts[2] };
}
