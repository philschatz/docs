/**
 * Encode/decode invite payloads with compression.
 *
 * Wire format: [4-byte seed length (big-endian)] [seed] [archive]
 * The entire payload is gzip-compressed before base64url encoding,
 * since keyhive archives can be hundreds of KB.
 */

async function compress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(data as any);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
}

async function decompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(data as any);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
}

function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeInvitePayload(
  seed: Uint8Array,
  archive: Uint8Array,
): Promise<string> {
  const payload = new Uint8Array(4 + seed.length + archive.length);
  const view = new DataView(payload.buffer);
  view.setUint32(0, seed.length);
  payload.set(seed, 4);
  payload.set(archive, 4 + seed.length);
  const compressed = await compress(payload);
  console.log(
    '[invite-codec] encode: raw=', payload.length,
    'compressed=', compressed.length,
    'ratio=', (compressed.length / payload.length * 100).toFixed(1) + '%',
  );
  return toBase64url(compressed);
}

export async function decodeInvitePayload(
  b64url: string,
): Promise<{ seed: Uint8Array; archive: Uint8Array }> {
  const compressed = fromBase64url(b64url);
  let bytes: Uint8Array;
  try {
    bytes = await decompress(compressed);
  } catch {
    // Fall back to uncompressed for old invite links
    bytes = compressed;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seedLen = view.getUint32(0);
  const seed = bytes.slice(4, 4 + seedLen);
  const archive = bytes.slice(4 + seedLen);
  console.log(
    '[invite-codec] decode: compressed=', compressed.length,
    'decompressed=', bytes.length,
    'seedLen=', seedLen,
    'archiveLen=', archive.length,
  );
  return { seed, archive };
}
