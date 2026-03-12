/** Convert an Automerge proxy value to a plain JS value safe for assignment. */
export function toPlain(v: any): any {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v);
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (Array.isArray(v)) return v.map(toPlain);
  const result: Record<string, any> = {};
  for (const key of Object.keys(v)) result[key] = toPlain(v[key]);
  return result;
}

/** Recursively sync a mutable Automerge doc to match a target snapshot. */
export function syncToTarget(d: any, target: any): void {
  // Delete keys not in target
  for (const key of Object.keys(d)) {
    if (!(key in target)) delete d[key];
  }
  // Set or recurse into keys from target
  for (const key of Object.keys(target)) {
    const tv = target[key];
    const dv = d[key];
    if (tv === null || typeof tv !== 'object') {
      if (dv !== tv) d[key] = tv;
    } else if (!Array.isArray(tv) && typeof dv === 'object' && dv !== null && !Array.isArray(dv)) {
      syncToTarget(dv, tv);
    } else {
      d[key] = toPlain(tv);
    }
  }
}
